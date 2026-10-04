import webpush from 'web-push';
import type {
  Chat,
  Message,
  NotificationPayload,
  PushSubscribeBody,
  WaStatus,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { loadOrCreateVapid, type VapidDetails } from './vapid.js';

export interface PushService {
  publicKey(): string;
  subscribe(userId: number, sub: PushSubscribeBody): void;
  unsubscribe(userId: number, endpoint: string): void;
  notifyInbound(chat: Chat, message: Message): Promise<void>;
  notifyAdmins(title: string, body: string): Promise<void>;
  /** detaches bus listeners */
  shutdown(): void;
}

/** Delivers one encrypted notification. Throws an error with `statusCode` on HTTP failure (web-push WebPushError). */
export type PushSender = (
  sub: PushSubscribeBody,
  payload: string,
  vapid: VapidDetails,
) => Promise<unknown>;

export interface PushDeps {
  sender?: PushSender;
  /** defaults to ctx.services.realtime?.isOnline (missing → nobody online) */
  isOnline?: (userId: number) => boolean;
}

interface SubRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const ALERT_STATES = new Set<WaStatus['state']>(['logged_out', 'replaced', 'blocked']);

/** Hostnames of the browser push services (FCM/Chrome+Edge, Mozilla, Windows WNS, Apple). */
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];
const PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

/**
 * SSRF guard: a push endpoint must be https on the default port and belong to a known push service.
 * Rejects IP literals, internal/LAN hosts and arbitrary URLs.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

const defaultSender: PushSender = async (sub, payload, vapid) => {
  if (!isAllowedPushEndpoint(sub.endpoint)) throw new Error('push endpoint not allowed');
  return webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
    vapidDetails: {
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
    TTL: 60 * 60 * 24,
  });
};

function statusCodeOf(err: unknown): number | null {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const c = Number((err as { statusCode: unknown }).statusCode);
    return Number.isFinite(c) ? c : null;
  }
  return null;
}

function waAlertText(s: WaStatus): { title: string; body: string } {
  switch (s.state) {
    case 'logged_out':
      return {
        title: 'WhatsApp disconnected',
        body: 'The linked number was logged out. Relink it from Admin > WhatsApp.',
      };
    case 'replaced':
      return {
        title: 'WhatsApp session replaced',
        body: 'Another device took over the session. Open Admin > WhatsApp to take it back.',
      };
    default:
      return { title: 'WhatsApp unavailable', body: s.lastError ?? `Connection state: ${s.state}` };
  }
}

export function createPushService(ctx: AppContext, deps: PushDeps = {}): PushService {
  const { db } = ctx;
  const log = ctx.log.child({ mod: 'push' });
  const vapid = loadOrCreateVapid(ctx.settings);
  const sender = deps.sender ?? defaultSender;
  const isOnline = (id: number): boolean => {
    if (deps.isOnline) return deps.isOnline(id);
    const rt = ctx.services.realtime as { isOnline?: (id: number) => boolean } | undefined;
    return typeof rt?.isOnline === 'function' ? rt.isOnline(id) : false;
  };

  const q = {
    upsert: db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ),
    delOwn: db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'),
    delById: db.prepare('DELETE FROM push_subscriptions WHERE id = ?'),
    activeUsers: db.prepare("SELECT id FROM users WHERE disabled_at IS NULL AND kind = 'human'"),
    activeAdmins: db.prepare("SELECT id FROM users WHERE disabled_at IS NULL AND role = 'admin'"),
    activeUser: db.prepare('SELECT id FROM users WHERE id = ? AND disabled_at IS NULL'),
    subsFor: db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'),
  };

  async function sendTo(userIds: number[], payload: NotificationPayload): Promise<void> {
    const json = JSON.stringify(payload);
    const jobs: Array<Promise<void>> = [];
    for (const uid of userIds) {
      for (const row of q.subsFor.all(uid) as SubRow[]) {
        const sub: PushSubscribeBody = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        jobs.push(
          sender(sub, json, vapid).then(
            () => undefined,
            (err: unknown) => {
              const code = statusCodeOf(err);
              if (code === 404 || code === 410) {
                q.delById.run(row.id);
                log.info({ userId: uid, code }, 'push subscription expired; removed');
              } else {
                log.warn({ err, userId: uid, code }, 'push send failed');
              }
            },
          ),
        );
      }
    }
    await Promise.all(jobs);
  }

  const ids = (rows: unknown[]) => (rows as Array<{ id: number }>).map((r) => r.id);

  function notifyConnected(userIds: number[], payload: NotificationPayload): void {
    // Hidden desktop windows remain connected; browser push skips online users.
    // Send only to the same eligible recipients, never the public "all" room.
    const rt = ctx.services.realtime;
    if (rt && userIds.length)
      rt.io.to(userIds.map((id) => `user:${id}`)).emit('notification:new', payload);
  }

  const service: PushService = {
    publicKey: () => vapid.publicKey,

    subscribe(userId, sub) {
      q.upsert.run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
    },

    unsubscribe(userId, endpoint) {
      q.delOwn.run(userId, endpoint);
    },

    async notifyInbound(chat, message) {
      let targets: number[];
      if (chat.assignedTo != null)
        targets = q.activeUser.get(chat.assignedTo) ? [chat.assignedTo] : [];
      else targets = ids(q.activeUsers.all());
      if (!targets.length) return;
      const preview = chat.lastMessagePreview ?? message.body ?? 'New message';
      const payload: NotificationPayload = {
        title: chat.name.slice(0, 200),
        body: preview.slice(0, 1000),
        url: `/chats/${encodeURIComponent(chat.jid)}`,
        tag: chat.jid,
      };
      notifyConnected(targets, payload);
      await sendTo(
        targets.filter((id) => !isOnline(id)),
        payload,
      );
    },

    async notifyAdmins(title, body) {
      const targets = ids(q.activeAdmins.all());
      if (!targets.length) return;
      const payload = {
        title: title.slice(0, 200),
        body: body.slice(0, 1000),
        url: '/admin/whatsapp',
        tag: 'wa-status',
      };
      notifyConnected(targets, payload);
      await sendTo(targets, payload);
    },

    shutdown() {
      ctx.bus.off('inbound:notify', onInbound);
      ctx.bus.off('wa:status', onWaStatus);
    },
  };

  const onInbound = ({ chat, message }: { chat: Chat; message: Message }) => {
    service
      .notifyInbound(chat, message)
      .catch((err: unknown) => log.warn({ err }, 'notifyInbound failed'));
  };
  let lastAlertState: WaStatus['state'] | null = null;
  const onWaStatus = (s: WaStatus) => {
    if (!ALERT_STATES.has(s.state)) {
      lastAlertState = null;
      return;
    }
    if (lastAlertState === s.state) return; // don't spam admins on repeated status events
    lastAlertState = s.state;
    const { title, body } = waAlertText(s);
    service
      .notifyAdmins(title, body)
      .catch((err: unknown) => log.warn({ err }, 'notifyAdmins failed'));
  };
  ctx.bus.on('inbound:notify', onInbound);
  ctx.bus.on('wa:status', onWaStatus);

  return service;
}

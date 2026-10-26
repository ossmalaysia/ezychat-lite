import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, Message } from '@ezychat/shared';
import { makeTestApp, type TestApp } from '../../test/helpers.js';
import { createPushService, type PushSender } from './service.js';
import type { RealtimeService } from '../realtime/socket.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

function mkUser(name: string, role: 'admin' | 'agent' = 'agent') {
  return t.ctx.services.auth!.createUser({
    username: name,
    displayName: name,
    role,
    password: 'password123',
    mustChangePassword: false,
  });
}

const JID = '60123@s.whatsapp.net';
const chat = (assignedTo: number | null): Chat => ({
  jid: JID,
  inboxId: 1,
  waJid: JID,
  type: 'dm',
  name: 'Alice',
  avatarUrl: null,
  unreadCount: 1,
  lastMessageAt: 1,
  lastInboundAt: null,
  lastMessagePreview: 'hello there',
  status: 'open',
  assignedTo,
  updatedAt: 1,
  phone: '60123',
});
const message = { id: 'm1', chatJid: JID, body: 'hello there' } as Message;

function setup(fail?: (endpoint: string) => number | null) {
  t.ctx.services.push!.shutdown();
  const sent: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const sender: PushSender = async (sub, payload) => {
    const code = fail?.(sub.endpoint) ?? null;
    if (code) throw Object.assign(new Error('push failed'), { statusCode: code });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
  };
  const logLines: string[] = [];
  const log = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
  const push = createPushService({ ...t.ctx, log }, { sender });
  t.ctx.services.push = push;
  return { push, sent, logLines };
}

function connectedNotifications() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  t.ctx.services.realtime = {
    io: { to },
    close: vi.fn(),
    isOnline: () => true,
  } as unknown as RealtimeService;
  return { to, emit };
}

const sub = (n: string) => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: 'p', auth: 'a' },
});

describe('PushService', () => {
  it('generates and persists a VAPID key pair', () => {
    const { push } = setup();
    const key = push.publicKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    expect(t.ctx.settings.getSecret('vapid_private')).toBeTruthy();
    const { push: again } = setup();
    expect(again.publicKey()).toBe(key);
  });

  it('assignee online on another device → their phone still gets the push', async () => {
    const a = mkUser('a1');
    const { push, sent } = setup();
    connectedNotifications(); // e.g. the desktop app is open: the user counts as online
    push.subscribe(a.id, sub('a'));
    await push.notifyInbound(chat(a.id), message);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/a']);
  });

  it('assignee offline → push to assignee only', async () => {
    const a = mkUser('a1');
    const b = mkUser('b1');
    const { push, sent } = setup();
    push.subscribe(a.id, sub('a'));
    push.subscribe(b.id, sub('b'));
    await push.notifyInbound(chat(a.id), message);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/a']);
    expect(sent[0]!.payload).toEqual({
      title: 'Alice',
      body: 'hello there',
      url: `/chats/${encodeURIComponent(JID)}`,
      tag: JID,
    });
  });

  it('unassigned → every active user, online or not', async () => {
    const a = mkUser('a1');
    const b = mkUser('b1');
    const c = mkUser('c1');
    const d = mkUser('d1');
    const { push, sent } = setup();
    for (const [u, n] of [
      [a, 'a'],
      [b, 'b'],
      [c, 'c'],
      [d, 'd'],
    ] as const)
      push.subscribe(u.id, sub(n));
    t.ctx.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(Date.now(), d.id);
    await push.notifyInbound(chat(null), message);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      'https://push.example/a',
      'https://push.example/b',
      'https://push.example/c',
    ]);
  });

  it('410/404 responses remove the subscription; other errors keep it', async () => {
    const a = mkUser('a1');
    const { push, sent } = setup((ep) =>
      ep.endsWith('/gone') ? 410 : ep.endsWith('/missing') ? 404 : ep.endsWith('/err') ? 500 : null,
    );
    push.subscribe(a.id, sub('gone'));
    push.subscribe(a.id, sub('missing'));
    push.subscribe(a.id, sub('err'));
    push.subscribe(a.id, sub('ok'));
    await push.notifyInbound(chat(null), message);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/ok']);
    const left = (
      t.ctx.db.prepare('SELECT endpoint FROM push_subscriptions ORDER BY endpoint').all() as Array<{
        endpoint: string;
      }>
    ).map((r) => r.endpoint);
    expect(left).toEqual(['https://push.example/err', 'https://push.example/ok']);
  });

  it('subscribe re-assigns an endpoint to the current user; unsubscribe only removes own', () => {
    const a = mkUser('a1');
    const b = mkUser('b1');
    const { push } = setup();
    push.subscribe(a.id, sub('x'));
    push.subscribe(b.id, sub('x'));
    expect(t.ctx.db.prepare('SELECT user_id FROM push_subscriptions').all()).toEqual([
      { user_id: b.id },
    ]);
    push.unsubscribe(a.id, 'https://push.example/x');
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({
      n: 1,
    });
    push.unsubscribe(b.id, 'https://push.example/x');
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({
      n: 0,
    });
  });

  it('notifyAdmins pushes to active admins only', async () => {
    const admin = mkUser('adm', 'admin');
    const agent = mkUser('agt', 'agent');
    const { push, sent } = setup();
    push.subscribe(admin.id, sub('adm'));
    push.subscribe(agent.id, sub('agt'));
    await push.notifyAdmins(() => ({ title: 'WhatsApp logged out', body: 'Relink required' }));
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/adm']);
    expect(sent[0]!.payload.title).toBe('WhatsApp logged out');
  });

  it('renders WhatsApp alerts in each admin preferred language', async () => {
    const en = mkUser('adm-en', 'admin');
    const ms = mkUser('adm-ms', 'admin');
    const zh = mkUser('adm-zh', 'admin');
    t.ctx.services.auth!.setLocale(ms.id, 'ms');
    t.ctx.services.auth!.setLocale(zh.id, 'zh-CN');
    const { push, sent } = setup();
    for (const u of [en, ms, zh]) push.subscribe(u.id, sub(String(u.id)));
    t.ctx.bus.emit('wa:status', { state: 'logged_out', me: null, qr: null, lastError: null });
    await new Promise((r) => setTimeout(r, 50));
    const titleFor = (id: number) =>
      sent.find((s) => s.endpoint === `https://push.example/${id}`)?.payload.title;
    expect(titleFor(en.id)).toBe('WhatsApp disconnected');
    expect(titleFor(ms.id)).toBe('WhatsApp terputus');
    expect(titleFor(zh.id)).toBe('WhatsApp 已断开');
    push.shutdown();
  });

  it('localizes the inbound fallback text when a message has no preview', async () => {
    const a = mkUser('loc-a');
    t.ctx.services.auth!.setLocale(a.id, 'ms');
    const { push, sent } = setup();
    push.subscribe(a.id, sub('loc-a'));
    await push.notifyInbound(
      { ...chat(a.id), lastMessagePreview: null },
      { ...message, body: null },
    );
    expect(sent[0]!.payload.body).toBe('Mesej baharu');
  });

  it('titles a chat without a name or phone "Unknown contact" and links its own JID', async () => {
    const a = mkUser('a1');
    const { push, sent } = setup();
    push.subscribe(a.id, sub('a'));
    await push.notifyInbound(
      { ...chat(a.id), jid: '123456789@lid', name: '', phone: null },
      message,
    );
    expect(sent[0]!.payload).toMatchObject({
      title: 'Unknown contact',
      url: '/chats/123456789%40lid',
      tag: '123456789@lid',
    });
  });

  it('routes bus inbound:notify and wa:status logged_out', async () => {
    const admin = mkUser('adm', 'admin');
    const { push, sent } = setup();
    push.subscribe(admin.id, sub('adm'));
    t.ctx.bus.emit('inbound:notify', { chat: chat(null), message });
    t.ctx.bus.emit('wa:status', { state: 'logged_out', me: null, qr: null, lastError: null });
    t.ctx.bus.emit('wa:status', { state: 'logged_out', me: null, qr: null, lastError: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBe(2);
    push.shutdown();
  });
});

describe('AI handover notifications', () => {
  it('targets only the assignee, live and on every device', async () => {
    const assigned = mkUser('assigned');
    const other = mkUser('other', 'admin');
    const { push, sent } = setup();
    const live = connectedNotifications();
    push.subscribe(assigned.id, sub('assigned'));
    push.subscribe(other.id, sub('other'));
    await push.notifyHandoff(chat(assigned.id));
    expect(live.to).toHaveBeenCalledExactlyOnceWith([`user:${assigned.id}`]);
    expect(live.emit).toHaveBeenCalledExactlyOnceWith('notification:new', {
      title: 'Chat handed over',
      body: 'Alice needs a teammate.',
      url: `/chats/${encodeURIComponent(JID)}`,
      tag: JID,
    });
    expect(sent.map((item) => item.endpoint)).toEqual(['https://push.example/assigned']);
  });

  it('unassigned notifies and pushes to every active human, and excludes disabled and AI users', async () => {
    const admin = mkUser('admin', 'admin');
    const online = mkUser('online');
    const offline = mkUser('offline');
    const disabled = mkUser('disabled');
    const ai = mkUser('robot');
    t.ctx.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(Date.now(), disabled.id);
    t.ctx.db.prepare("UPDATE users SET kind = 'ai' WHERE id = ?").run(ai.id);
    const { push, sent } = setup();
    const live = connectedNotifications();
    for (const user of [admin, online, offline, disabled, ai])
      push.subscribe(user.id, sub(user.username));
    await push.notifyHandoff(chat(null));
    expect(live.to).toHaveBeenCalledExactlyOnceWith([
      `user:${admin.id}`,
      `user:${online.id}`,
      `user:${offline.id}`,
    ]);
    expect(sent.map((item) => item.endpoint).sort()).toEqual([
      'https://push.example/admin',
      'https://push.example/offline',
      'https://push.example/online',
    ]);
  });

  it('logs the delivery counts of each notification, never the chat or the contact', async () => {
    const user = mkUser('counted');
    const { push, logLines } = setup((ep) =>
      ep.endsWith('/gone') ? 410 : ep.endsWith('/err') ? 500 : null,
    );
    for (const n of ['phone', 'laptop', 'gone', 'err']) push.subscribe(user.id, sub(n));
    await push.notifyHandoff(chat(user.id));
    const result = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((o) => o.event === 'push_result');
    expect(result).toEqual([
      expect.objectContaining({
        mod: 'push',
        kind: 'handoff',
        recipients: 1,
        devices: 4,
        sent: 2,
        failed: 1,
        removed: 1,
      }),
    ]);
    const all = logLines.join('\n');
    expect(all).not.toContain('Alice');
    expect(all).not.toContain(JID);
    expect(all).not.toContain('push.example');
  });

  it.each(['disabled', 'ai', 'missing'] as const)(
    'does not broadcast when the assignee is %s',
    async (kind) => {
      const assigned = mkUser('assigned');
      const other = mkUser('other');
      if (kind === 'disabled')
        t.ctx.db
          .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
          .run(Date.now(), assigned.id);
      if (kind === 'ai')
        t.ctx.db.prepare("UPDATE users SET kind = 'ai' WHERE id = ?").run(assigned.id);
      const { push, sent } = setup();
      const live = connectedNotifications();
      for (const user of [assigned, other]) push.subscribe(user.id, sub(user.username));
      await push.notifyHandoff(chat(kind === 'missing' ? 99999 : assigned.id));
      expect(live.to).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    },
  );

  it.each([
    ['en', 'Chat handed over', 'Alice needs a teammate.'],
    ['ms', 'Sembang diserahkan', 'Alice memerlukan bantuan ahli pasukan.'],
    ['zh-CN', '会话已转交', 'Alice需要团队成员协助。'],
  ] as const)('uses the recipient language: %s', async (locale, title, body) => {
    const user = mkUser('localized');
    t.ctx.services.auth!.setLocale(user.id, locale);
    const { push, sent } = setup();
    push.subscribe(user.id, sub('localized'));
    await push.notifyHandoff(chat(user.id));
    expect(sent[0]?.payload).toMatchObject({ title, body });
  });

  it('routes a handover once and stops listening after shutdown', async () => {
    const user = mkUser('recipient');
    const { push, sent } = setup();
    push.subscribe(user.id, sub('recipient'));
    t.ctx.bus.emit('ai:handoff', chat(user.id));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    push.shutdown();
    // Other services (the calendar's hand-over line) may still listen: push must not send again.
    t.ctx.bus.emit('ai:handoff', chat(user.id));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toHaveLength(1);
  });
});

describe('isAllowedPushEndpoint', () => {
  it('allows known push services and rejects everything else', async () => {
    const { isAllowedPushEndpoint } = await import('./service.js');
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://web.push.apple.com/abc',
    ]) {
      expect(isAllowedPushEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://10.0.0.5/x',
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilnotify.windows.com/x',
      'https://user:pw@fcm.googleapis.com/x',
      'not a url',
    ]) {
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
    }
  });
});

describe('several inboxes', () => {
  beforeEach(async () => {
    await t.close();
    t = await makeTestApp({ maxInboxes: 3, inboxes: 2 });
  });
  const KEY2 = `${JID}#2`;
  const chat2 = (assignedTo: number | null): Chat => ({
    ...chat(assignedTo),
    jid: KEY2,
    inboxId: 2,
  });

  it('an unassigned inbox 2 chat notifies admins and inbox 2 members only', async () => {
    const admin = mkUser('adm', 'admin');
    const member = mkUser('two');
    const outsider = mkUser('one');
    t.ctx.inboxes.repo.setUserInboxes(member.id, [2]);
    t.ctx.inboxes.repo.setUserInboxes(outsider.id, [1]);
    const { push, sent } = setup();
    const live = connectedNotifications();
    for (const u of [admin, member, outsider]) push.subscribe(u.id, sub(String(u.id)));
    await push.notifyInbound(chat2(null), { ...message, chatJid: KEY2 });
    expect(sent.map((s) => s.endpoint).sort()).toEqual(
      [admin.id, member.id].map((id) => `https://push.example/${id}`).sort(),
    );
    expect(live.to).toHaveBeenCalledWith(
      expect.arrayContaining([`user:${admin.id}`, `user:${member.id}`]),
    );
    expect(live.to).not.toHaveBeenCalledWith(expect.arrayContaining([`user:${outsider.id}`]));
    await push.notifyHandoff(chat2(null));
    expect(sent.filter((s) => s.endpoint.endsWith(`/${outsider.id}`))).toEqual([]);
  });

  it('a chat key that does not parse reaches nobody', async () => {
    const admin = mkUser('adm', 'admin');
    const { push, sent } = setup();
    push.subscribe(admin.id, sub('adm'));
    await push.notifyInbound({ ...chat(null), jid: `${JID}#1` }, message);
    expect(sent).toEqual([]);
  });

  it('an assignee who lost the inbox gets nothing', async () => {
    const agent = mkUser('lost');
    t.ctx.inboxes.repo.setUserInboxes(agent.id, [1]);
    const { push, sent } = setup();
    push.subscribe(agent.id, sub('lost'));
    await push.notifyInbound(chat2(agent.id), message);
    expect(sent).toEqual([]);
    t.ctx.inboxes.repo.setUserInboxes(agent.id, [1, 2]);
    await push.notifyInbound(chat2(agent.id), message);
    expect(sent).toHaveLength(1);
  });

  it('WhatsApp alerts are per inbox, name the inbox and open Admin → Inboxes', async () => {
    const admin = mkUser('adm', 'admin');
    const { push, sent } = setup();
    push.subscribe(admin.id, sub('adm'));
    const down = { state: 'logged_out' as const, me: null, qr: null, lastError: null };
    t.ctx.bus.emit('inbox:status', { inboxId: 2, status: down });
    t.ctx.bus.emit('inbox:status', { inboxId: 2, status: down });
    // inbox 1 alerts come from wa:status (its inbox:status is not counted twice)
    t.ctx.bus.emit('inbox:status', { inboxId: 1, status: down });
    t.ctx.bus.emit('wa:status', down);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(2);
    const byTag = new Map(sent.map((s) => [s.payload.tag, s.payload]));
    expect(byTag.get('wa-status-2')).toMatchObject({
      title: 'Inbox 2: WhatsApp disconnected',
      url: '/admin/inboxes',
    });
    expect(String(byTag.get('wa-status-2')!.body)).toContain('Admin > Inboxes');
    expect(byTag.get('wa-status')).toMatchObject({
      title: 'WhatsApp: WhatsApp disconnected',
      url: '/admin/inboxes',
    });
    // back online, then down again: a new alert
    t.ctx.bus.emit('inbox:status', { inboxId: 2, status: { ...down, state: 'open' } });
    t.ctx.bus.emit('inbox:status', { inboxId: 2, status: { ...down, state: 'replaced' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(3);
    expect(sent[2]!.payload.title).toBe('Inbox 2: WhatsApp session replaced');
    push.shutdown();
  });

  it('a removed inbox no longer counts: one active inbox alerts as before', async () => {
    const admin = mkUser('adm', 'admin');
    t.ctx.inboxes.repo.markRemoved(2, Date.now());
    const { push, sent } = setup();
    push.subscribe(admin.id, sub('adm'));
    t.ctx.bus.emit('wa:status', { state: 'blocked', me: null, qr: null, lastError: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent[0]!.payload).toMatchObject({
      title: 'WhatsApp unavailable',
      url: '/admin/whatsapp',
      tag: 'wa-status',
    });
    push.shutdown();
  });
});

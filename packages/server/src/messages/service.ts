import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import mime from 'mime-types';
import type {
  Message,
  MessageListQuery,
  MessageStatus,
  MessageType,
  SendTextBody,
} from '@wa-team-inbox/shared';
import type { SendResult, WaIncomingMessage, WaMessageStatusUpdate } from '@wa-team-inbox/wa';
import type { AppContext } from '../context.js';
import { errors } from '../http/errors.js';
import { getAliases } from '../chats/aliases.js';
import { ChatRepo, rowToChat } from '../chats/repo.js';
import { isFallbackName } from '../chats/service.js';
import { MediaStore } from './media-store.js';
import { MessageRepo, previewOf, rowToMessage, STATUS_RANK, type MessageRow } from './repo.js';
import { SendQueue, type SendJob } from './send-queue.js';
import { DownloadLimiter } from './download-limiter.js';

export interface MediaFile {
  path: string;
  mime: string;
  name: string | null;
}

/** live media downloads (and on-demand redownloads) running at once */
export const MEDIA_DOWNLOAD_CONCURRENCY = 2;
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;

export interface MessageService {
  list(jid: string, q: MessageListQuery): { messages: Message[]; nextBefore: string | null };
  ingest(m: WaIncomingMessage, source: 'live' | 'history'): Promise<Message | null>;
  sendText(jid: string, body: SendTextBody, userId: number): Message;
  sendMedia(
    jid: string,
    file: { buffer: Buffer; fileName: string; caption?: string; quotedId?: string },
    userId: number,
    clientId: string,
  ): Promise<Message>;
  retry(id: string, userId: number): Message;
  applyStatus(u: WaMessageStatusUpdate): void;
  mediaPath(id: string): MediaFile | null;
  redownload(id: string): Promise<Message>;
  /**
   * Media file for serving. A 'pending' (not yet fetched, e.g. history) message is downloaded on
   * demand first. Returns null when the message has no servable media, 'unavailable' when it was
   * pending but the download failed.
   */
  ensureMedia(id: string): Promise<MediaFile | null | 'unavailable'>;
  /** the outbound queue (bridge calls queue.onConnected()) */
  readonly queue: SendQueue;
  /** stops the queue */
  shutdown(): void;
}

export function encodeBefore(ts: number, id: string): string {
  return `${ts}_${id}`;
}

export function decodeBefore(s: string): { ts: number; id: string } | null {
  const i = s.indexOf('_');
  if (i <= 0) return null;
  const ts = Number(s.slice(0, i));
  const id = s.slice(i + 1);
  return Number.isFinite(ts) && id ? { ts, id } : null;
}

export function messageTypeForMime(m: string): MessageType {
  if (m === 'image/webp') return 'image';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

function extFor(mimeType: string, fileName: string | null): string {
  const fromName = fileName && /\.([a-zA-Z0-9]{1,10})$/.exec(fileName)?.[1];
  return (mime.extension(mimeType) || fromName || 'bin').toString();
}

export interface MessageServiceDeps {
  now?: () => number;
  /** overrides for the queue (tests) */
  queue?: { spacingMs?: number; maxAgeMs?: number; sleep?: (ms: number) => Promise<void> };
  /** overrides for the media download limiter (tests) */
  downloads?: { concurrency?: number; timeoutMs?: number };
}

export function createMessageService(ctx: AppContext, deps?: MessageServiceDeps): MessageService {
  const repo = new MessageRepo(ctx.db);
  const chats = new ChatRepo(ctx.db);
  const media = new MediaStore(join(ctx.config.dataDir, 'media'));
  const now = deps?.now ?? Date.now;
  const log = ctx.log.child({ mod: 'messages' });

  /** WA statuses that arrived before the local row was renamed to the WA id. */
  const earlyStatus = new Map<string, WaMessageStatusUpdate['status']>();
  /** chat jid → in-flight send promise (used to de-duplicate echoes of our own sends). */
  const inflight = new Map<string, Promise<unknown>>();
  const reconciliations = new Map<string, () => void>();

  const emitChat = (jid: string) => {
    const r = chats.get(jid);
    if (r) ctx.bus.emit('chat:updated', rowToChat(r));
    return r ? rowToChat(r) : null;
  };

  const emitStatus = (r: MessageRow, newId?: string) => {
    ctx.bus.emit('message:status', {
      id: r.id,
      clientId: r.client_id,
      chatJid: r.chat_jid,
      status: r.status,
      error: r.error,
      ...(newId ? { newId } : {}),
    });
  };

  /** Bumps chat last-message fields if this message is the newest. */
  const touchChat = (r: MessageRow, t: number) => {
    const chat = chats.get(r.chat_jid);
    if (!chat) return;
    if (chat.last_message_at === null || r.timestamp >= chat.last_message_at) {
      chats.update(r.chat_jid, {
        last_message_at: r.timestamp,
        last_message_preview: previewOf(r),
        updated_at: t,
      });
    } else {
      chats.update(r.chat_jid, { updated_at: t });
    }
  };

  const sendJob = async (job: SendJob): Promise<SendResult> => {
    const row = repo.get(job.localId);
    if (!row || row.status !== 'pending') throw new Error('Message is no longer pending');
    if (
      row.sent_by_user_id &&
      ctx.services.auth?.getUser(row.sent_by_user_id)?.kind === 'ai' &&
      !ctx.services.ai?.canSend(job.chatJid, row.sent_by_user_id, job.quotedId)
    ) {
      throw new Error('AI reply cancelled because chat ownership changed');
    }
    // Echoes must wait until the queue commits sender provenance, not merely until WA returns.
    const guard = new Promise<void>((resolve) => {
      reconciliations.set(job.localId, () => {
        if (inflight.get(job.chatJid) === guard) inflight.delete(job.chatJid);
        reconciliations.delete(job.localId);
        resolve();
      });
    });
    inflight.set(job.chatJid, guard);
    const p = (async () => {
      if (job.kind === 'text') {
        return ctx.wa.sendText(
          job.targetJid,
          job.text ?? '',
          job.quotedId ? { quotedId: job.quotedId } : undefined,
        );
      }
      const buffer = readFileSync(media.abs(job.mediaPath!));
      return ctx.wa.sendMedia(
        job.targetJid,
        {
          buffer,
          mime: job.mime ?? 'application/octet-stream',
          fileName: job.fileName ?? 'file',
          ...(job.caption ? { caption: job.caption } : {}),
        },
        job.quotedId ? { quotedId: job.quotedId } : undefined,
      );
    })();
    try {
      return await p;
    } catch (error) {
      reconciliations.get(job.localId)?.();
      throw error;
    }
  };

  const onSent = (job: SendJob, r: SendResult) => {
    try {
      const row = repo.get(job.localId);
      if (!row) return;
      const waId = r.id;
      ctx.db.transaction(() => {
        if (waId !== job.localId) {
          // an echo of our own send may already have been ingested under the WA id
          if (repo.exists(waId)) repo.delete(waId);
          repo.rename(job.localId, waId);
        }
        const early = earlyStatus.get(waId);
        earlyStatus.delete(waId);
        if (early === 'failed') {
          // an ERROR ack arrived before the local -> WA id rename: keep the failure
          repo.update(waId, { status: 'failed', error: 'Delivery failed' });
        } else {
          const status: MessageStatus =
            early && STATUS_RANK[early] > STATUS_RANK.sent ? early : 'sent';
          repo.update(waId, { status, error: null });
        }
      })();
      const updated = repo.get(waId)!;
      emitStatus({ ...updated, status: 'sent' }, waId);
      if (updated.status !== 'sent') emitStatus(updated);
    } finally {
      reconciliations.get(job.localId)?.();
    }
  };

  const onFailed = (job: SendJob, err: Error) => {
    try {
      const row = repo.get(job.localId);
      if (!row || row.status !== 'pending') return;
      const msg = err.message || 'Send failed';
      repo.update(job.localId, { status: 'failed', error: msg });
      log.warn({ id: job.localId, chatJid: job.chatJid, err: msg }, 'send failed');
      emitStatus(repo.get(job.localId)!);
    } finally {
      reconciliations.get(job.localId)?.();
    }
  };

  const queue = new SendQueue({
    send: sendJob,
    onSent,
    onFailed,
    isConnected: () => ctx.wa.status.state === 'open',
    presence: (job) => ctx.wa.sendPresence(job.targetJid, 'composing'),
    now,
    ...(deps?.queue ?? {}),
  });

  /** `address` still belongs to the person of `chatJid` (not a number recycled to someone else). */
  const addressOf = (address: string, chatJid: string): boolean => {
    if (address === chatJid) return true;
    const aliases = getAliases(ctx);
    return aliases.resolve(address) === chatJid || aliases.route(address) === chatJid;
  };

  /**
   * Restored and retried jobs re-check their stored target: a number re-pointed to another person
   * since the message was queued falls back to the chat JID (persisted on the row).
   */
  const jobTarget = (r: MessageRow): string => {
    const stored = r.wa_remote_jid ?? r.chat_jid;
    if (addressOf(stored, r.chat_jid)) return stored;
    repo.update(r.id, { wa_remote_jid: r.chat_jid });
    log.warn(
      { id: r.id, chatJid: r.chat_jid, stored },
      'send target moved to another WhatsApp ID; sending to the chat instead',
    );
    return r.chat_jid;
  };

  const MOVED_NUMBER_MESSAGE =
    'This phone number now belongs to a different WhatsApp account; reply from the current chat.';

  /** The chat's own phone number was re-pointed to another person: nothing may be sent from it. */
  const chatNumberMoved = (chatJid: string): boolean => getAliases(ctx).movedAway(chatJid);

  const failMoved = (r: MessageRow): void => {
    log.warn(
      { id: r.id, chatJid: r.chat_jid },
      'send refused: chat number moved to another WhatsApp ID',
    );
    repo.update(r.id, { status: 'failed', error: MOVED_NUMBER_MESSAGE });
    emitStatus(repo.get(r.id)!);
  };

  /** Queue a row's send, or fail it when its chat's number now belongs to someone else. */
  const enqueueRow = (r: MessageRow): void => {
    if (chatNumberMoved(r.chat_jid)) failMoved(r);
    else queue.enqueue(jobFromRow(r));
  };

  const jobFromRow = (r: MessageRow): SendJob => {
    const base = {
      localId: r.id,
      chatJid: r.chat_jid,
      targetJid: jobTarget(r),
      createdAt: r.created_at,
      ...(r.quoted_id ? { quotedId: r.quoted_id } : {}),
    };
    if (r.media_path) {
      return {
        ...base,
        kind: 'media',
        mediaPath: r.media_path,
        mime: r.media_mime ?? 'application/octet-stream',
        fileName: r.media_name ?? 'file',
        ...(r.body ? { caption: r.body } : {}),
      };
    }
    return { ...base, kind: 'text', text: r.body ?? '' };
  };

  /**
   * Where a reply goes: the address of the customer's last inbound message (PN or LID, as WhatsApp
   * delivered it), unless that address now belongs to someone else (a recycled number) → the chat JID.
   */
  const replyTarget = (chatJid: string): string => {
    const last = repo.lastInboundRemoteJid(chatJid);
    return last && addressOf(last, chatJid) ? last : chatJid;
  };

  const requireChat = (jid: string) => {
    const c = chats.get(jid);
    if (!c) throw errors.notFound('Chat');
    return c;
  };

  /** The first teammate to reply in an unassigned chat becomes its owner; an existing owner is kept. */
  const claimIfUnassigned = (jid: string, userId: number, t: number) => {
    if (requireChat(jid).assigned_to !== null) return;
    chats.update(jid, { assigned_to: userId, updated_at: t });
    const ev = chats.insertEvent({
      chatJid: jid,
      type: 'assigned',
      actorId: userId,
      payload: { assignedTo: userId, previous: null, reason: 'reply' },
      at: t,
    });
    ctx.bus.emit('chat:event', ev);
  };

  const insertOutgoing = (row: MessageRow): Message => {
    const t = row.created_at;
    repo.insert(row);
    touchChat(row, t);
    const msg = rowToMessage(repo.get(row.id)!);
    ctx.bus.emit('message:new', msg);
    emitChat(row.chat_jid);
    enqueueRow(row);
    return msg;
  };

  const downloads = new DownloadLimiter({
    concurrency: deps?.downloads?.concurrency ?? MEDIA_DOWNLOAD_CONCURRENCY,
    timeoutMs: deps?.downloads?.timeoutMs ?? MEDIA_DOWNLOAD_TIMEOUT_MS,
  });
  const redownloads = new Map<string, Promise<Message>>();

  const doRedownload = async (id: string): Promise<Message> => {
    const r = repo.get(id);
    if (!r) throw errors.notFound('Message');
    if (r.type === 'text' || r.type === 'system') throw errors.validation('Message has no media');
    let buf: Buffer | null = null;
    try {
      buf = await downloads.run(() => ctx.wa.downloadMedia(id));
    } catch (err) {
      log.warn({ err, id }, 'media redownload failed');
    }
    if (!buf) {
      repo.update(id, { media_status: 'failed' });
      throw errors.conflict('Media is no longer available');
    }
    const mimeType =
      r.media_mime ??
      (await fileTypeFromBuffer(buf).catch(() => undefined))?.mime ??
      'application/octet-stream';
    const rel = media.save(r.chat_jid, id, buf, extFor(mimeType, r.media_name));
    repo.update(id, { media_path: rel, media_mime: mimeType, media_status: 'ok' });
    return rowToMessage(repo.get(id)!);
  };

  const svc: MessageService = {
    queue,

    list(jid, q) {
      let before: { ts: number; id: string } | null = null;
      if (q.before) {
        before = decodeBefore(q.before);
        if (!before) throw errors.validation('Invalid before cursor');
      }
      const rows = repo.pageDesc(jid, before, q.limit + 1);
      const more = rows.length > q.limit;
      const page = more ? rows.slice(0, q.limit) : rows;
      const oldest = page[page.length - 1];
      return {
        messages: page.reverse().map(rowToMessage),
        nextBefore: more && oldest ? encodeBefore(oldest.timestamp, oldest.id) : null,
      };
    },

    async ingest(m, source) {
      if (repo.exists(m.id)) return null;
      const isGroup = m.chatJid.endsWith('@g.us');
      const aliases = getAliases(ctx);
      if (!isGroup && m.chatJidAlt) {
        // Persist the pair; routing never merges (a second chat waits for the next start).
        aliases.learn(
          { jid: m.chatJid, alias: m.chatJidAlt },
          source === 'history' ? 'history' : 'message',
        );
      }
      // One person, one chat: the existing chat of either address (the LID chat first).
      const chatJid = isGroup ? m.chatJid : aliases.route(m.chatJid);
      // Our own send may echo before the queue has committed its WhatsApp id and sender. The guard
      // is keyed by the chat the send came from: the routed chat, or a PN chat still kept separate.
      const guard = m.fromMe ? (inflight.get(chatJid) ?? inflight.get(m.chatJid)) : undefined;
      if (guard) {
        await guard;
        if (repo.exists(m.id)) return null;
      }
      const t = now();
      const chatBefore = chats.ensure(
        chatJid,
        { name: !isGroup && !m.fromMe ? m.senderName : null },
        t,
      );

      const row: MessageRow = {
        id: m.id,
        chat_jid: chatJid,
        sender_jid: m.senderJid,
        sender_name: m.senderName,
        from_me: m.fromMe ? 1 : 0,
        sent_by_user_id: null,
        type: m.type,
        body: m.body,
        media_path: null,
        media_mime: m.media?.mime ?? null,
        media_name: m.media?.fileName ?? null,
        media_status: m.media ? 'pending' : 'none',
        quoted_id: m.quotedId,
        status: m.fromMe ? 'sent' : 'delivered',
        error: null,
        timestamp: m.timestamp,
        created_at: t,
        client_id: null,
        wa_remote_jid: m.chatJid,
      };
      if (!repo.insert(row)) return null; // concurrent duplicate

      const isNewLiveInbound = source === 'live' && !m.fromMe;
      let reopened = false;
      ctx.db.transaction(() => {
        touchChat(row, t);
        if (isNewLiveInbound) {
          ctx.db
            .prepare('UPDATE chats SET unread_count = unread_count + 1 WHERE jid = ?')
            .run(chatJid);
          const cur = chats.get(chatJid)!;
          if (cur.status === 'resolved') {
            chats.update(chatJid, { status: 'open', updated_at: t });
            reopened = true;
          }
        }
        if (!isGroup && !m.fromMe && m.senderName && isFallbackName(chatBefore.name, chatJid)) {
          chats.setName(chatJid, m.senderName, t);
        }
        if (m.senderJid && m.senderName && !m.fromMe) {
          chats.upsertContact({ jid: m.senderJid, pushName: m.senderName, savedName: null });
        }
      })();
      if (reopened) {
        const ev = chats.insertEvent({
          chatJid,
          type: 'reopened',
          actorId: null,
          payload: { reason: 'inbound' },
          at: t,
        });
        ctx.bus.emit('chat:event', ev);
      }

      if (source === 'live') {
        // AI Sales Agent trigger (#18): keyed by the routed chat, where its ai_chat_state lives.
        ctx.bus.emit('message:received', {
          chat: rowToChat(chats.get(chatJid)!),
          message: rowToMessage(row),
        });
      }

      // History media stays 'pending' (mime/name kept) and is fetched on demand (ensureMedia /
      // redownload): eagerly pulling every history file from the CDN floods the network and used
      // to crash the server on a single ECONNRESET. Live media downloads through the limiter.
      if (m.media && source === 'live') {
        const dl = m.media.download;
        try {
          const buf = await downloads.run(() => dl());
          const rel = media.save(chatJid, m.id, buf, extFor(m.media.mime, m.media.fileName));
          repo.update(m.id, { media_path: rel, media_status: 'ok' });
        } catch (err) {
          log.warn({ err, id: m.id }, 'media download failed');
          repo.update(m.id, { media_status: 'failed' });
        }
      }

      const final = repo.get(m.id);
      if (!final) return null;
      const msg = rowToMessage(final);
      ctx.bus.emit('message:new', msg);
      const chat = emitChat(chatJid);
      if (isNewLiveInbound && chat) ctx.bus.emit('inbound:notify', { chat, message: msg });
      return msg;
    },

    sendText(jid, body, userId) {
      const existing = repo.byClientId(body.clientId);
      if (existing) return rowToMessage(existing);
      requireChat(jid);
      if (chatNumberMoved(jid)) throw errors.conflict(MOVED_NUMBER_MESSAGE);
      const t = now();
      claimIfUnassigned(jid, userId, t);
      return insertOutgoing({
        id: `local-${body.clientId}`,
        chat_jid: jid,
        sender_jid: ctx.wa.status.me?.jid ?? null,
        sender_name: null,
        from_me: 1,
        sent_by_user_id: userId,
        type: 'text',
        body: body.text,
        media_path: null,
        media_mime: null,
        media_name: null,
        media_status: 'none',
        quoted_id: body.quotedId ?? null,
        status: 'pending',
        error: null,
        timestamp: t,
        created_at: t,
        client_id: body.clientId,
        wa_remote_jid: replyTarget(jid),
      });
    },

    async sendMedia(jid, file, userId, clientId) {
      const existing = repo.byClientId(clientId);
      if (existing) return rowToMessage(existing);
      requireChat(jid);
      if (chatNumberMoved(jid)) throw errors.conflict(MOVED_NUMBER_MESSAGE);
      if (!file.buffer.length) throw errors.validation('Empty file');
      const sniffed = await fileTypeFromBuffer(file.buffer).catch(() => undefined);
      const mimeType = sniffed?.mime ?? (mime.lookup(file.fileName) || 'application/octet-stream');
      const ext = sniffed?.ext ?? extFor(mimeType, file.fileName);
      const id = `local-${clientId}`;
      const rel = media.save(jid, id, file.buffer, ext);
      const t = now();
      claimIfUnassigned(jid, userId, t);
      return insertOutgoing({
        id,
        chat_jid: jid,
        sender_jid: ctx.wa.status.me?.jid ?? null,
        sender_name: null,
        from_me: 1,
        sent_by_user_id: userId,
        type: messageTypeForMime(mimeType),
        body: file.caption?.trim() ? file.caption : null,
        media_path: rel,
        media_mime: mimeType,
        media_name: file.fileName.slice(0, 255) || null,
        media_status: 'ok',
        quoted_id: file.quotedId ?? null,
        status: 'pending',
        error: null,
        timestamp: t,
        created_at: t,
        client_id: clientId,
        wa_remote_jid: replyTarget(jid),
      });
    },

    retry(id, _userId) {
      const r = repo.get(id);
      if (!r) throw errors.notFound('Message');
      if (r.status !== 'failed' || !r.from_me)
        throw errors.conflict('Only failed outgoing messages can be retried');
      const t = now();
      if (!r.id.startsWith('local-')) {
        // Failed after reaching WhatsApp (ERROR ack, row already renamed to the WA id): turn it back into
        // a pending local row so the queue re-sends it (and it survives a restart via pendingLocal()).
        if (r.type !== 'text' && !r.media_path)
          throw errors.conflict('This message can no longer be re-sent');
        if (r.type === 'text' && !r.body)
          throw errors.conflict('This message can no longer be re-sent');
        const clientId = r.client_id ?? randomUUID();
        const localId = `local-${clientId}`;
        if (repo.exists(localId)) throw errors.conflict('Message is already being re-sent');
        ctx.db.transaction(() => {
          repo.rename(r.id, localId);
          repo.update(localId, {
            status: 'pending',
            error: null,
            created_at: t,
            client_id: clientId,
          });
        })();
        const moved = repo.get(localId)!;
        emitStatus({ ...moved, id: r.id }, localId);
        enqueueRow(moved);
        return rowToMessage(moved);
      }
      repo.update(id, { status: 'pending', error: null, created_at: t });
      const updated = repo.get(id)!;
      emitStatus(updated);
      enqueueRow(updated);
      return rowToMessage(updated);
    },

    applyStatus(u) {
      const r = repo.get(u.id);
      if (!r) {
        // may belong to a send whose ack has not been processed yet
        if (earlyStatus.size > 500) earlyStatus.clear();
        const prev = earlyStatus.get(u.id);
        // a failure is sticky: a later (or reordered) ack must not mask it
        if (prev === 'failed') return;
        if (!prev || u.status === 'failed' || STATUS_RANK[u.status] > STATUS_RANK[prev])
          earlyStatus.set(u.id, u.status);
        return;
      }
      if (u.status === 'failed') {
        if (r.status !== 'pending' && r.status !== 'sent') return;
        repo.update(u.id, { status: 'failed', error: r.error ?? 'Delivery failed' });
      } else {
        if (r.status === 'failed' || STATUS_RANK[u.status] <= STATUS_RANK[r.status]) return;
        repo.update(u.id, { status: u.status });
      }
      emitStatus(repo.get(u.id)!);
    },

    mediaPath(id) {
      // a client may still hold the optimistic local id after the row was renamed to the WA id
      const r =
        repo.get(id) ??
        (id.startsWith('local-') ? repo.byClientId(id.slice('local-'.length)) : null);
      if (!r || !r.media_path) return null;
      let p: string;
      try {
        p = media.abs(r.media_path);
      } catch {
        return null;
      }
      if (!existsSync(p)) return null;
      return { path: p, mime: r.media_mime ?? 'application/octet-stream', name: r.media_name };
    },

    redownload(id) {
      // de-duplicate concurrent requests for the same message (e.g. a thumbnail and a viewer)
      const existing = redownloads.get(id);
      if (existing) return existing;
      const p = doRedownload(id).finally(() => redownloads.delete(id));
      redownloads.set(id, p);
      return p;
    },

    async ensureMedia(id) {
      const ready = svc.mediaPath(id);
      if (ready) return ready;
      const r = repo.get(id);
      if (!r || r.media_status !== 'pending') return null;
      try {
        await svc.redownload(id);
      } catch {
        return 'unavailable';
      }
      return svc.mediaPath(id) ?? 'unavailable';
    },

    shutdown() {
      queue.stop();
    },
  };

  // restore persisted pending sends (expired ones fail immediately when processed)
  const pending = repo.pendingLocal();
  if (pending.length) {
    const live = pending.filter((r) => {
      if (!chatNumberMoved(r.chat_jid)) return true;
      failMoved(r);
      return false;
    });
    queue.restore(live.map(jobFromRow));
  }

  return svc;
}

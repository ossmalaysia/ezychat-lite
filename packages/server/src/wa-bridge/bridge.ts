import type { WaStatus } from '@wa-team-inbox/shared';
import type { WaChatInfo, WaContactInfo, WaIncomingMessage, WaMessageStatusUpdate } from '@wa-team-inbox/wa';
import type { AppContext } from '../context.js';

/**
 * Wires WaAdapter events into the domain services:
 * message → messages.ingest; messageStatus → applyStatus; chats → upsertFromWa; contacts → contacts upsert;
 * status → remembered in memory (ctx.services.waStatus) + bus 'wa:status'; when open → sendQueue.onConnected().
 * Returns a detach function.
 */
export function attachWaBridge(ctx: AppContext): () => void {
  const messages = ctx.services.messages;
  const chats = ctx.services.chats;
  if (!messages || !chats) throw new Error('attachWaBridge: chats/messages services not initialized');
  const log = ctx.log.child({ mod: 'wa-bridge' });

  const onMessage = (m: WaIncomingMessage, meta: { source: 'live' | 'history' }) => {
    messages.ingest(m, meta?.source ?? 'live').catch((err: unknown) => log.error({ err, id: m.id }, 'ingest failed'));
  };
  const onStatusUpdate = (u: WaMessageStatusUpdate) => {
    try {
      messages.applyStatus(u);
    } catch (err) {
      log.error({ err, id: u.id }, 'applyStatus failed');
    }
  };
  const onChats = (list: WaChatInfo[]) => {
    try {
      ctx.db.transaction(() => {
        for (const c of list) chats.upsertFromWa(c);
      })();
    } catch (err) {
      log.error({ err }, 'chats upsert failed');
    }
  };
  const onContacts = (list: WaContactInfo[]) => {
    try {
      chats.upsertContacts(list);
    } catch (err) {
      log.error({ err }, 'contacts upsert failed');
    }
  };
  const onStatus = (s: WaStatus) => {
    const prev = ctx.services.waStatus;
    ctx.services.waStatus = s;
    ctx.bus.emit('wa:status', s);
    if (s.state === 'open' && prev?.state !== 'open') messages.queue.onConnected();
  };

  ctx.services.waStatus = ctx.wa.status;
  ctx.wa.on('message', onMessage);
  ctx.wa.on('messageStatus', onStatusUpdate);
  ctx.wa.on('chats', onChats);
  ctx.wa.on('contacts', onContacts);
  ctx.wa.on('status', onStatus);
  if (ctx.wa.status.state === 'open') messages.queue.onConnected();

  return () => {
    ctx.wa.off('message', onMessage);
    ctx.wa.off('messageStatus', onStatusUpdate);
    ctx.wa.off('chats', onChats);
    ctx.wa.off('contacts', onContacts);
    ctx.wa.off('status', onStatus);
  };
}

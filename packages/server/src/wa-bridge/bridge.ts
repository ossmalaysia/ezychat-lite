import type { WaStatus } from '@ezychat/shared';
import type {
  WaAdapter,
  WaChatInfo,
  WaContactInfo,
  WaContactAlias,
  WaIncomingMessage,
  WaMessageEdit,
  WaMessageRevoke,
  WaMessageStatusUpdate,
  WaReaction,
} from '@ezychat/wa';
import type { AppContext } from '../context.js';
import { getChatHide } from '../chats/hide.js';
import { PRIMARY_INBOX_ID } from '../inboxes/keys.js';
import { capabilitiesOf } from '../inboxes/types.js';

/**
 * Wires the events of one inbox's WaAdapter into the domain services:
 * message → messages.ingest; reaction → messages.applyReaction; messageEdited / messageDeleted →
 * applyRemoteEdit / applyRemoteDelete; messageStatus → applyStatus; chats → upsertFromWa (all with the
 * inbox); contacts → contacts upsert; status → bus 'inbox:status' (every inbox) and, for inbox 1,
 * ctx.services.waStatus + bus 'wa:status'; when open → that inbox's send queue onConnected().
 * Returns a detach function.
 */
/**
 * Most history events (history messages and changes, chat lists) of a new link held until its number
 * is known; later ones are dropped, never routed into the old number's hidden chats. Live events always
 * wait (they need an open connection, which knows its number, so they are few).
 */
export const HELD_EVENTS_MAX = 50_000;

export function attachWaBridge(
  ctx: AppContext,
  inboxId: number = PRIMARY_INBOX_ID,
  wa: WaAdapter = ctx.inboxes.connections.adapter(inboxId),
): () => void {
  const messages = ctx.services.messages;
  const chats = ctx.services.chats;
  if (!messages || !chats)
    throw new Error('attachWaBridge: chats/messages services not initialized');
  const primary = inboxId === PRIMARY_INBOX_ID;
  const log = primary
    ? ctx.log.child({ mod: 'wa-bridge' })
    : ctx.log.child({ mod: 'wa-bridge', inboxId });
  let detached = false;
  let connectionGeneration = 0;

  const restoreContactAliases = () => {
    const generation = ++connectionGeneration;
    void (async () => {
      try {
        const jids = chats.contactJids();
        const aliases = await wa.getContactAliases(jids);
        if (detached || generation !== connectionGeneration || wa.status.state !== 'open') return;
        chats.upsertContactAliases(aliases);
        log.info(
          { contactCount: jids.length, aliasCount: aliases.length },
          'local contact alias recovery completed',
        );
      } catch (err) {
        if (!detached && generation === connectionGeneration)
          log.warn({ err }, 'local contact alias recovery failed');
      }
    })();
  };

  /** Remembers the inbox's own number, so alias learning ignores it after an unlink too. */
  const rememberOwnJid = (s: WaStatus) => {
    const jid = s.me?.jid;
    if (!jid) return;
    try {
      const row = ctx.inboxes.repo.get(inboxId);
      if (row && row.own_jid !== jid) ctx.inboxes.repo.setOwnJid(inboxId, jid);
    } catch (err) {
      log.warn({ err }, 'own number not saved');
    }
  };

  /** Hidden chats meet the number that linked now: the same number shows them, another archives them. */
  const meetHiddenChats = (s: WaStatus) => {
    const jid = s.me?.jid;
    if (!jid) return;
    try {
      getChatHide(ctx).onLinked(inboxId, jid);
    } catch (err) {
      log.error({ err }, 'hidden chats not checked on link');
    }
  };

  /**
   * The linked phone logged out (the admin's Log out or an unlink on the phone): the inbox's chats are
   * hidden. Never for a connection that is not linked by QR (Business API), nor for an adapter the
   * inbox already let go of (inbox removed or its type changed: that logout is ours).
   */
  const hideOnLogout = (before: WaStatus) => {
    if (!capabilitiesOf(wa).qrLink) return;
    try {
      if (ctx.inboxes.connections.adapter(inboxId) !== wa) return;
    } catch {
      return; // the inbox has no connection any more (removed)
    }
    try {
      // the number the connection reported last, for an inbox that has none saved
      getChatHide(ctx).hideInbox(inboxId, before.me?.jid ?? null);
    } catch (err) {
      log.error({ err }, 'chats not hidden on logout');
    }
  };

  /**
   * Events of a new link that arrive while chats are hidden and its number is still unknown (before
   * `open`) wait here: routed now, they would land in the old number's hidden chats (and be archived
   * with them). They run in order once the number decided (`onConnected`, or the next event with it).
   */
  const held: Array<() => void> = [];
  /** History events held now (bounded by HELD_EVENTS_MAX) and dropped past it, for this link. */
  let heldHistory = 0;
  let dropped = 0;
  const runHeld = () => {
    if (dropped) log.warn({ dropped }, 'history events dropped before the link opened');
    heldHistory = 0;
    dropped = 0;
    for (const run of held.splice(0)) run();
  };
  const linkDecided = () => {
    try {
      return getChatHide(ctx).linkDecided(inboxId, wa.status.me?.jid);
    } catch (err) {
      log.error({ err }, 'hidden chats not checked for an event');
      return true;
    }
  };
  /**
   * Runs `run` now, or holds it until the link's number is known. A history event past the limit is
   * dropped (fail closed: the old number's chats never receive it; WhatsApp keeps it on the phone).
   */
  const gate = (run: () => void, history: boolean) => {
    if (linkDecided()) {
      runHeld();
      run();
      return;
    }
    if (history) {
      if (heldHistory >= HELD_EVENTS_MAX) {
        dropped++;
        return;
      }
      heldHistory++;
    }
    held.push(run);
  };

  const onConnected = () => {
    meetHiddenChats(wa.status);
    runHeld();
    rememberOwnJid(wa.status);
    messages.queueFor(inboxId).onConnected();
    restoreContactAliases();
  };

  const onMessage = (m: WaIncomingMessage, meta: { source: 'live' | 'history' }) =>
    gate(() => {
      messages
        .ingest(m, meta?.source ?? 'live', inboxId)
        .catch((err: unknown) => log.error({ err, id: m.id }, 'ingest failed'));
    }, meta?.source === 'history');
  const onReaction = (r: WaReaction, meta: { source: 'live' | 'history' }) =>
    gate(() => {
      try {
        messages.applyReaction(r, meta?.source ?? 'live', inboxId);
      } catch (err) {
        log.error({ err, id: r.targetId }, 'reaction not stored');
      }
    }, meta?.source === 'history');
  const onEdited = (e: WaMessageEdit, meta: { source: 'live' | 'history' }) =>
    gate(() => {
      try {
        messages.applyRemoteEdit(e, meta?.source ?? 'live', inboxId);
      } catch (err) {
        log.error({ err, id: e.targetId }, 'edit not stored');
      }
    }, meta?.source === 'history');
  const onDeleted = (r: WaMessageRevoke, meta: { source: 'live' | 'history' }) =>
    gate(() => {
      try {
        messages.applyRemoteDelete(r, meta?.source ?? 'live', inboxId);
      } catch (err) {
        log.error({ err, id: r.targetId }, 'delete not stored');
      }
    }, meta?.source === 'history');
  const onStatusUpdate = (u: WaMessageStatusUpdate) => {
    try {
      messages.applyStatus(u, inboxId);
    } catch (err) {
      log.error({ err, id: u.id }, 'applyStatus failed');
    }
  };
  const onChats = (list: WaChatInfo[]) =>
    gate(() => {
      try {
        // the phone still has these chats: a chat hidden on Log out comes back for the same number
        getChatHide(ctx).showIfHidden(
          inboxId,
          list.map((c) => c.jid),
        );
        ctx.db.transaction(() => {
          for (const c of list) chats.syncFromWa(c, inboxId);
        })();
      } catch (err) {
        log.error({ err }, 'chats upsert failed');
      }
    }, true);
  const onContacts = (list: WaContactInfo[]) => {
    try {
      chats.upsertContacts(list);
    } catch (err) {
      log.error({ err }, 'contacts upsert failed');
    }
  };
  const onContactAliases = (list: WaContactAlias[]) => {
    try {
      chats.upsertContactAliases(list);
    } catch (err) {
      log.error({ err }, 'contact aliases upsert failed');
    }
  };
  let prev: WaStatus = wa.status;
  const onStatus = (s: WaStatus) => {
    const before = prev;
    prev = s;
    if (primary) {
      ctx.services.waStatus = s;
      ctx.bus.emit('wa:status', s);
    }
    ctx.bus.emit('inbox:status', { inboxId, status: s });
    if (s.state === 'open' && before.state !== 'open') onConnected();
    else if (s.state !== 'open') connectionGeneration++;
    if (s.state === 'logged_out' && before.state !== 'logged_out') hideOnLogout(before);
  };

  if (primary) ctx.services.waStatus = wa.status;
  wa.on('message', onMessage);
  wa.on('reaction', onReaction);
  wa.on('messageEdited', onEdited);
  wa.on('messageDeleted', onDeleted);
  wa.on('messageStatus', onStatusUpdate);
  wa.on('chats', onChats);
  wa.on('contacts', onContacts);
  wa.on('contactAliases', onContactAliases);
  wa.on('status', onStatus);
  if (wa.status.state === 'open') onConnected();

  return () => {
    detached = true;
    connectionGeneration++;
    held.length = 0;
    wa.off('message', onMessage);
    wa.off('reaction', onReaction);
    wa.off('messageEdited', onEdited);
    wa.off('messageDeleted', onDeleted);
    wa.off('messageStatus', onStatusUpdate);
    wa.off('chats', onChats);
    wa.off('contacts', onContacts);
    wa.off('contactAliases', onContactAliases);
    wa.off('status', onStatus);
  };
}

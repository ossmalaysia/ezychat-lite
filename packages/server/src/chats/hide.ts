import { renameSync } from 'node:fs';
import { join } from 'node:path';
import type { HiddenChatsInfo } from '@ezychat/shared';
import { avatarFileName } from '../avatars/store.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { chatKey } from '../inboxes/keys.js';
import { numberOfJid } from '../inboxes/service.js';
import { getAliases } from './aliases.js';
import { CHAT_TABLES } from './delete.js';
import { LOGGED_OUT_MESSAGE } from './hidden-sql.js';
import { waJidOf, type ChatColumns } from './repo.js';

/**
 * Hide chats on Log out (docs/features/chat-hide-delete/design.md Part A). The only code that hides,
 * shows again or archives chats. A hidden chat (`chats.hidden_at` set) behaves like a chat that does
 * not exist for everyone (admins, the AI and MCP too); nothing is deleted.
 */

export { HIDDEN_CHAT_KEYS, LOGGED_OUT_MESSAGE, isChatHidden, visibleChat } from './hidden-sql.js';

/** An archived chat's WhatsApp JID ends in `~old<n>` (a different number linked after it was hidden). */
const ARCHIVED_MARK = '~old';
const NOT_ARCHIVED = `COALESCE(wa_jid, '') NOT LIKE '%${ARCHIVED_MARK}%'`;

/** How quietly WhatsApp must report chats before one `chats.shown_on_relink` row is written. */
export const SHOWN_AUDIT_QUIET_MS = 30_000;

export interface ChatHideService {
  /**
   * The admin's Log out (or Link again) of this inbox starts: a `logged_out` until the returned
   * function runs is recorded as `admin` (else `phone`).
   */
  markAdminLogout(inboxId: number): () => void;
  /**
   * The inbox's linked phone logged out: hides every chat of the inbox (one transaction), fails its
   * queued sends and stops AI work for them. `lastJid`: the number the connection last reported, used
   * when the inbox has none saved (else the chats keep an unknown number: archived at the next link,
   * whatever number it is). Returns how many chats were hidden.
   */
  hideInbox(inboxId: number, lastJid?: string | null): number;
  /**
   * May an event of the inbox's current link be handled now? False while chats are hidden and the
   * new link's number is not known yet (its events must not land in the old number's chats). With
   * `ownJid` (the connection's number, even before `open`) it decides first, as onLinked.
   */
  linkDecided(inboxId: number, ownJid: string | null | undefined): boolean;
  /**
   * A phone linked to the inbox (`ownJid` = its own WhatsApp JID), before the bridge saves the number.
   * The same number: hidden chats come back one by one as WhatsApp reports them (`showIfHidden`). A
   * different number: every hidden chat is archived and stays hidden for good. Chats hidden while
   * the number was unknown are archived too (fail closed: an unknown number never matches).
   */
  onLinked(inboxId: number, ownJid: string): void;
  /**
   * WhatsApp reported these JIDs (a chat in its chat list or group list, or a message): their hidden
   * chat in `inboxId` is shown again when the same number linked again. Returns the shown keys.
   */
  showIfHidden(inboxId: number, waJids: ReadonlyArray<string | null | undefined>): string[];
  /** Admin read: hidden chats of the inbox's current number, and its visible chats. */
  info(inboxId: number): HiddenChatsInfo;
  /** Writes the pending `chats.shown_on_relink` rows now (tests, shutdown). */
  flushShownAudit(): void;
  shutdown(): void;
}

declare module '../context.js' {
  interface Services {
    chatHide?: ChatHideService;
  }
}

export function createChatHideService(
  ctx: AppContext,
  deps: { now?: () => number } = {},
): ChatHideService {
  const now = deps.now ?? (() => Date.now());
  const log = ctx.log.child({ mod: 'chats' });
  const db = ctx.db;
  /** Inboxes whose same number linked again while chats were hidden → that number's digits. */
  const armed = new Map<number, string>();
  /** Admin logouts not yet seen as a status change. */
  const adminLogouts = new Set<number>();
  /** inboxId → chats shown since the last audit row, and its timer. */
  const shown = new Map<number, { count: number; timer: ReturnType<typeof setTimeout> }>();
  /**
   * inboxId → keys of its hidden, not archived chats (read once, then kept in step), so the many
   * messages of a history sync are matched in memory and only a hidden chat costs a query.
   */
  const hiddenKeys = new Map<number, Set<string>>();

  const ownNumber = (inboxId: number) => numberOfJid(ctx.inboxes.repo.get(inboxId)?.own_jid);

  const writeShown = (inboxId: number) => {
    const s = shown.get(inboxId);
    if (!s) return;
    clearTimeout(s.timer);
    shown.delete(inboxId);
    audit(db, {
      userId: null,
      action: 'chats.shown_on_relink',
      ip: null,
      meta: { inboxId, count: s.count },
    });
    log.info({ inboxId, count: s.count }, 'hidden chats shown again');
  };

  const countShown = (inboxId: number, n: number) => {
    const s = shown.get(inboxId);
    if (s) {
      s.count += n;
      s.timer.refresh();
      return;
    }
    const timer = setTimeout(() => writeShown(inboxId), SHOWN_AUDIT_QUIET_MS);
    timer.unref?.();
    shown.set(inboxId, { count: n, timer });
  };

  const hiddenRows = (inboxId: number) =>
    db
      .prepare(
        `SELECT jid, wa_jid, hidden_number FROM chats
         WHERE inbox_id = ? AND hidden_at IS NOT NULL AND ${NOT_ARCHIVED} ORDER BY jid`,
      )
      .all(inboxId) as Array<
      Pick<ChatColumns, 'jid' | 'wa_jid'> & { hidden_number: string | null }
    >;

  const keysOf = (inboxId: number): Set<string> => {
    let set = hiddenKeys.get(inboxId);
    if (!set) {
      set = new Set(hiddenRows(inboxId).map((r) => r.jid));
      hiddenKeys.set(inboxId, set);
    }
    return set;
  };

  /** The chat keys `waJid` can have in the inbox: itself, its LID and the LID's phone numbers. */
  const candidateKeys = (inboxId: number, waJid: string): string[] => {
    const aliases = getAliases(ctx);
    const jids = new Set<string>([waJid]);
    if (!waJid.endsWith('@g.us')) {
      const lid = aliases.resolve(waJid);
      jids.add(lid);
      if (lid.endsWith('@lid'))
        for (const p of aliases.aliasesOf(lid)) if (!aliases.movedAway(p)) jids.add(p);
    }
    const out: string[] = [];
    for (const j of jids) {
      try {
        out.push(chatKey(inboxId, j));
      } catch {
        // a JID that is no chat key (e.g. contains '#') names no chat
      }
    }
    return out;
  };

  const keyTaken = db.prepare('SELECT 1 FROM chats WHERE jid = ?');
  const moves = CHAT_TABLES.map((table) =>
    db.prepare(`UPDATE ${table} SET chat_jid = @to WHERE chat_jid = @from`),
  );
  // every column of the row (a later migration's too), with the new key and WhatsApp JID
  const columns = (db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  const copyChat = db.prepare(
    `INSERT INTO chats (${columns.map((c) => `"${c}"`).join(', ')})
     SELECT ${columns.map((c) => (c === 'jid' ? '@to' : c === 'wa_jid' ? '@waJid' : `"${c}"`)).join(', ')}
     FROM chats WHERE jid = @from`,
  );
  const moveAvatar = db.prepare('UPDATE avatars SET key = @to WHERE key = @from');
  const dropChat = db.prepare('DELETE FROM chats WHERE jid = @from');

  /**
   * Re-keys one hidden chat to `<waJid>~old<n>` in every chat-keyed table (the `DELETE_PLAN` list of
   * Delete chat), so the inbox's unique (inbox, WhatsApp JID) is free for the new number. Returns the
   * old and new key: the stored photo file (named after the key) moves after the commit.
   */
  const archiveOne = (
    inboxId: number,
    row: Pick<ChatColumns, 'jid' | 'wa_jid'>,
  ): { from: string; to: string } => {
    const waJid = waJidOf(row);
    let n = 1;
    while (keyTaken.get(chatKey(inboxId, `${waJid}${ARCHIVED_MARK}${n}`))) n++;
    const archivedJid = `${waJid}${ARCHIVED_MARK}${n}`;
    const to = chatKey(inboxId, archivedJid);
    const from = row.jid;
    copyChat.run({ to, from, waJid: archivedJid });
    // ai_chat_state cascades from chats: moved like the rest before the old row goes
    for (const m of moves) m.run({ to, from });
    moveAvatar.run({ to, from });
    dropChat.run({ from });
    return { from, to };
  };

  /** Moves each archived chat's photo file with its `avatars` row, so the old key keeps no photo. */
  const moveAvatarFiles = (moved: ReadonlyArray<{ from: string; to: string }>) => {
    const dir = join(ctx.config.dataDir, 'avatars');
    let failed = 0;
    for (const { from, to } of moved) {
      try {
        renameSync(join(dir, avatarFileName(from)), join(dir, avatarFileName(to)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
      }
    }
    if (failed) log.warn({ failed }, 'archived chat photos not moved');
  };

  const svc: ChatHideService = {
    markAdminLogout(inboxId) {
      adminLogouts.add(inboxId);
      return () => adminLogouts.delete(inboxId);
    },

    hideInbox(inboxId, lastJid) {
      const via = adminLogouts.has(inboxId) ? 'admin' : 'phone';
      armed.delete(inboxId);
      hiddenKeys.delete(inboxId);
      const number = ownNumber(inboxId) ?? numberOfJid(lastJid);
      const at = now();
      const keys = db.transaction(() => {
        const keys = (
          db
            .prepare('SELECT jid FROM chats WHERE inbox_id = ? AND hidden_at IS NULL')
            .all(inboxId) as Array<{ jid: string }>
        ).map((r) => r.jid);
        if (!keys.length) return keys;
        db.prepare(
          'UPDATE chats SET hidden_at = ?, hidden_number = ? WHERE inbox_id = ? AND hidden_at IS NULL',
        ).run(at, number, inboxId);
        // queued and restored sends of those chats never go out (e.g. later, from another number)
        db.prepare(
          `UPDATE messages SET status = 'failed', error = ?
           WHERE status = 'pending' AND (id LIKE 'local-%' OR from_me = 1)
             AND chat_jid IN (SELECT jid FROM chats WHERE inbox_id = ? AND hidden_at = ?)`,
        ).run(LOGGED_OUT_MESSAGE, inboxId, at);
        audit(db, {
          userId: null,
          action: 'chats.hidden_on_logout',
          ip: null,
          meta: { inboxId, count: keys.length, via },
        });
        return keys;
      })();
      if (!keys.length) return 0;
      let queue: { drop(jid: string): number } | undefined;
      try {
        queue = ctx.services.messages?.queueFor(inboxId);
      } catch {
        queue = undefined; // an inbox without a connection has no queue
      }
      for (const jid of keys) {
        queue?.drop(jid);
        ctx.services.ai?.cancelChat(jid);
      }
      ctx.bus.emit('chats:hidden', { inboxId });
      log.info({ inboxId, count: keys.length, via }, 'chats hidden on logout');
      return keys.length;
    },

    onLinked(inboxId, ownJid) {
      const number = numberOfJid(ownJid);
      if (!number) return;
      const rows = hiddenRows(inboxId);
      if (!rows.length) {
        armed.delete(inboxId);
        return;
      }
      // a chat hidden while the number was unknown never matches: another person's phone could link
      const other = rows.filter((r) => r.hidden_number !== number);
      if (other.length) {
        const moved = db.transaction(() => {
          const moved = other.map((r) => archiveOne(inboxId, r));
          audit(db, {
            userId: null,
            action: 'chats.archived_on_relink',
            ip: null,
            meta: { inboxId, count: other.length },
          });
          return moved;
        })();
        moveAvatarFiles(moved);
        log.info({ inboxId, count: other.length }, 'hidden chats archived: another number linked');
        hiddenKeys.delete(inboxId);
      }
      if (other.length < rows.length) armed.set(inboxId, number);
      else armed.delete(inboxId);
    },

    linkDecided(inboxId, ownJid) {
      if (armed.has(inboxId) || keysOf(inboxId).size === 0) return true;
      if (ownJid) svc.onLinked(inboxId, ownJid);
      return armed.has(inboxId) || keysOf(inboxId).size === 0;
    },

    showIfHidden(inboxId, waJids) {
      const number = armed.get(inboxId);
      if (!number) return [];
      const hiddenSet = keysOf(inboxId);
      const keys = new Set<string>();
      for (const j of waJids)
        if (j) for (const k of candidateKeys(inboxId, j)) if (hiddenSet.has(k)) keys.add(k);
      if (!keys.size) return [];
      const list = JSON.stringify([...keys]);
      const out = db.transaction(() => {
        const rows = db
          .prepare(
            `SELECT jid FROM chats WHERE inbox_id = ? AND hidden_number = ?
               AND hidden_at IS NOT NULL AND ${NOT_ARCHIVED} AND jid IN (SELECT value FROM json_each(?))`,
          )
          .all(inboxId, number, list) as Array<{ jid: string }>;
        if (!rows.length) return [];
        const jids = rows.map((r) => r.jid);
        db.prepare(
          `UPDATE chats SET hidden_at = NULL, hidden_number = NULL
           WHERE jid IN (SELECT value FROM json_each(?))`,
        ).run(JSON.stringify(jids));
        return jids;
      })();
      for (const jid of out) hiddenSet.delete(jid);
      if (!out.length) return out;
      countShown(inboxId, out.length);
      for (const jid of out) {
        const chat = ctx.services.chats?.get(jid);
        if (chat) ctx.bus.emit('chat:updated', chat);
      }
      // nothing hidden left: stop looking
      if (hiddenSet.size === 0) armed.delete(inboxId);
      return out;
    },

    info(inboxId) {
      const number = ownNumber(inboxId);
      const hidden = number
        ? (
            db
              .prepare(
                `SELECT COUNT(*) AS n FROM chats WHERE inbox_id = ? AND hidden_at IS NOT NULL
                   AND hidden_number = ? AND ${NOT_ARCHIVED}`,
              )
              .get(inboxId, number) as { n: number }
          ).n
        : 0;
      const visible = (
        db
          .prepare('SELECT COUNT(*) AS n FROM chats WHERE inbox_id = ? AND hidden_at IS NULL')
          .get(inboxId) as { n: number }
      ).n;
      return { visible, hidden, number: hidden ? number : null };
    },

    flushShownAudit() {
      for (const inboxId of [...shown.keys()]) writeShown(inboxId);
    },

    shutdown() {
      svc.flushShownAudit();
    },
  };
  return svc;
}

/** The hide service of this app (created on first use: the WhatsApp bridge may need it first). */
export function getChatHide(ctx: AppContext): ChatHideService {
  return (ctx.services.chatHide ??= createChatHideService(ctx));
}

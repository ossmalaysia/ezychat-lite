import { readdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatDeletePreview } from '@ezychat/shared';
import { avatarFileName } from '../avatars/store.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import type { DB } from '../db/index.js';
import { errors } from '../http/errors.js';
import { getAliases } from './aliases.js';
import { parseChatKey } from '../inboxes/keys.js';
import { chatMediaDir, MediaStore } from '../messages/media-store.js';
import { waJidOf, type ChatColumns } from './repo.js';

/**
 * Delete chat (admins; docs/features/chat-hide-delete/design.md Part B). The only way to delete a
 * chat: its rows in every chat-keyed and message-keyed table, its files and its photo. `contacts`,
 * `jid_aliases`, `safety_numbers` (shared by every inbox) and `audit_log` are never touched.
 */

/** Tables holding rows of the chat's messages (`message_id` = a stored message key). */
export const MESSAGE_TABLES = [
  'message_reactions',
  'message_edits',
  'media_refs',
  'media_thumbs',
] as const;

/** Tables keyed by the chat key (`chat_jid`); `messages` last but one, the `chats` row last. */
export const CHAT_TABLES = [
  'notes',
  'chat_events',
  'ai_chat_state',
  'customer_profiles',
  'customer_tags',
  'member_chats',
  'ai_group_chats',
  'ai_scheduled_tasks',
  'safety_items',
  'message_changes_pending',
  'calendar_offers',
  'calendar_bookings',
  'calendar_activity',
  'sheets_leads',
  'sheets_activity',
  'drive_saved_files',
  'drive_activity',
  'connector_activity',
  'connector_values',
  'connector_calls',
  'sql_account_links',
  'sql_account_seen_items',
  'sql_account_quotes',
  'sql_account_activity',
  'messages',
] as const;

/**
 * Every DELETE of one chat, in order (`@jid` = the chat key). `chat-delete-coverage.test.ts` fails
 * when a table with a `chat_jid` or message-id column is missing here, so a new table never leaves
 * orphans.
 */
export const DELETE_PLAN: ReadonlyArray<{ table: string; sql: string }> = [
  ...MESSAGE_TABLES.map((table) => ({
    table,
    sql: `DELETE FROM ${table} WHERE message_id IN (SELECT id FROM messages WHERE chat_jid = @jid)`,
  })),
  // rows that belong to the chat through another row (foreign key cascades, written out)
  {
    table: 'ai_scheduled_runs',
    sql: 'DELETE FROM ai_scheduled_runs WHERE task_id IN (SELECT id FROM ai_scheduled_tasks WHERE chat_jid = @jid)',
  },
  {
    table: 'safety_downloads',
    sql: 'DELETE FROM safety_downloads WHERE item_id IN (SELECT id FROM safety_items WHERE chat_jid = @jid)',
  },
  ...CHAT_TABLES.map((table) => ({ table, sql: `DELETE FROM ${table} WHERE chat_jid = @jid` })),
  // the chat's WhatsApp photo (its key is the chat key)
  { table: 'avatars', sql: 'DELETE FROM avatars WHERE key = @jid' },
  { table: 'chats', sql: 'DELETE FROM chats WHERE jid = @jid' },
];

/**
 * When an admin deleted the chat of any of `waJids` in `inboxId` (the newest), else null. History sync
 * and WhatsApp's chat list never bring such a chat back; a live message starts a new one.
 */
export function chatDeletedAt(
  db: DB,
  inboxId: number,
  waJids: Iterable<string | null | undefined>,
): number | null {
  const list = [...new Set([...waJids].filter((j): j is string => !!j))];
  if (!list.length) return null;
  const row = db
    .prepare(
      `SELECT MAX(deleted_at) AS at FROM deleted_chats WHERE inbox_id = ? AND wa_jid IN (SELECT value FROM json_each(?))`,
    )
    .get(inboxId, JSON.stringify(list)) as { at: number | null };
  return row.at;
}

/**
 * As chatDeletedAt for every address of the same person: each JID, the LID a phone number resolves to,
 * and every phone number of each LID (a chat deleted under one address is found under the other).
 */
export function personDeletedAt(
  ctx: AppContext,
  inboxId: number,
  waJids: Iterable<string | null | undefined>,
): number | null {
  const aliases = getAliases(ctx);
  const all = new Set<string>();
  for (const j of waJids) {
    if (!j) continue;
    all.add(j);
    all.add(aliases.resolve(j));
  }
  for (const j of [...all])
    if (j.endsWith('@lid')) for (const p of aliases.aliasesOf(j)) all.add(p);
  return chatDeletedAt(ctx.db, inboxId, all);
}

export interface ChatDeleteResult {
  messages: number;
  files: number;
}

export interface ChatDeleteService {
  /** What a delete would remove (messages and files the team sees). */
  preview(jid: string): ChatDeletePreview;
  /**
   * Deletes the chat for good (the WhatsApp phone keeps its copy): stops its sends and AI work, removes
   * every row in one transaction with a tombstone, then its files. 404 when the chat does not exist.
   */
  deleteChat(jid: string, actor: { userId: number; ip: string | null }): Promise<ChatDeleteResult>;
}

declare module '../context.js' {
  interface Services {
    chatDelete?: ChatDeleteService;
  }
}

/** Removes `file` (no error when it is missing); false when the removal failed. */
async function remove(file: string): Promise<boolean> {
  try {
    await rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function createChatDeleteService(
  ctx: AppContext,
  deps: { now?: () => number } = {},
): ChatDeleteService {
  const now = deps.now ?? (() => Date.now());
  const log = ctx.log.child({ mod: 'chats' });
  const media = new MediaStore(join(ctx.config.dataDir, 'media'));
  const avatarDir = join(ctx.config.dataDir, 'avatars');
  const statements = DELETE_PLAN.map((p) => ctx.db.prepare(p.sql));
  const getChat = ctx.db.prepare('SELECT jid, wa_jid, inbox_id, type FROM chats WHERE jid = ?');
  const tombstone = ctx.db.prepare(
    `INSERT INTO deleted_chats (inbox_id, wa_jid, deleted_at) VALUES (?, ?, ?)
     ON CONFLICT(inbox_id, wa_jid) DO UPDATE SET deleted_at = excluded.deleted_at`,
  );
  /** Of `paths`, the ones a stored message still uses (a copy in another chat). */
  const stillUsed = ctx.db.prepare(
    'SELECT DISTINCT media_path AS p FROM messages WHERE media_path IN (SELECT value FROM json_each(?))',
  );

  type Row = Pick<ChatColumns, 'jid' | 'wa_jid'> & { inbox_id: number | null; type: string };
  const chatRow = (jid: string): Row => {
    const row = getChat.get(jid) as Row | undefined;
    if (!row) throw errors.notFound('Chat');
    return row;
  };

  /** Stops what would still write to or send from the chat: queued sends, AI replies and timers. */
  const stopLiveWork = (jid: string, inboxId: number) => {
    try {
      ctx.services.messages?.queueFor(inboxId).drop(jid);
    } catch {
      // a removed inbox has no queue: nothing waits to be sent
    }
    ctx.services.ai?.cancelChat(jid);
  };

  /** Removes the chat's files after the commit; returns how many removals failed. */
  async function removeFiles(jid: string, paths: string[]): Promise<number> {
    let failed = 0;
    const dir = chatMediaDir(jid);
    const candidates = new Set<string>();
    for (const p of paths) {
      candidates.add(p);
      // a High-risk file moved to quarantine keeps its old path inside the quarantine folder
      if (!p.startsWith('quarantine/')) candidates.add(`quarantine/${p}.bin`);
    }
    // files of the chat's folder no message points at (left by an earlier failure)
    const names = await readdir(media.abs(dir)).catch(() => [] as string[]);
    for (const name of names) candidates.add(`${dir}/${name}`);
    // never a file another chat still uses (a merge can leave another chat's files in this folder)
    const used = new Set(
      (stillUsed.all(JSON.stringify([...candidates])) as Array<{ p: string }>).map((r) => r.p),
    );
    for (const rel of candidates) {
      if (used.has(rel)) continue;
      let file: string;
      try {
        file = media.abs(rel);
      } catch {
        continue; // a stored path outside the media folder is never followed
      }
      if (!(await remove(file))) failed++;
    }
    // the folder only when nothing is left in it
    await rmdir(media.abs(dir)).catch(() => undefined);
    if (!(await remove(join(avatarDir, avatarFileName(jid))))) failed++;
    return failed;
  }

  return {
    preview(jid) {
      chatRow(jid);
      const r = ctx.db
        .prepare(
          // every message the delete removes (hidden-for-the-team ones too), as the audit counts them
          'SELECT COUNT(*) AS messages, COUNT(media_path) AS files FROM messages WHERE chat_jid = ?',
        )
        .get(jid) as ChatDeletePreview;
      return { messages: r.messages, files: r.files };
    },

    async deleteChat(jid, actor) {
      const chat = chatRow(jid);
      const inboxId = chat.inbox_id ?? parseChatKey(jid).inboxId;
      stopLiveWork(jid, inboxId);
      const members = (
        ctx.db.prepare('SELECT user_id FROM member_chats WHERE chat_jid = ?').all(jid) as Array<{
          user_id: number;
        }>
      ).map((r) => r.user_id);
      const { messages, paths } = ctx.db.transaction(() => {
        const paths = (
          ctx.db
            .prepare(
              'SELECT media_path FROM messages WHERE chat_jid = ? AND media_path IS NOT NULL',
            )
            .all(jid) as Array<{ media_path: string }>
        ).map((r) => r.media_path);
        let messages = 0;
        DELETE_PLAN.forEach((p, i) => {
          const changes = statements[i]!.run({ jid }).changes;
          if (p.table === 'messages') messages = changes;
        });
        tombstone.run(inboxId, waJidOf(chat), now());
        audit(ctx.db, {
          userId: actor.userId,
          action: 'chat.deleted',
          ip: actor.ip,
          meta: { chatJid: jid, messages, files: paths.length },
        });
        return { messages, paths };
      })();
      ctx.bus.emit('chat:deleted', { jid });
      // agents limited to chosen chats leave the chat's room
      for (const userId of members) ctx.bus.emit('member-chats:changed', userId);
      const failed = await removeFiles(jid, paths);
      log.info({ chatJid: jid, messages, files: paths.length, failed }, 'chat deleted');
      return { messages, files: paths.length };
    },
  };
}

export function initChatDelete(ctx: AppContext): void {
  ctx.services.chatDelete = createChatDeleteService(ctx);
}

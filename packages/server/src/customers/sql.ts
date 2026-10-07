/**
 * SQL that reads the customer tables for the chat read model (chats/repo). A leaf module: it imports
 * nothing from chats/, so chats/repo can use it without an import cycle. Fragments expect the chats
 * table aliased `c`.
 */
import type { DB } from '../db/index.js';

/** Joins the profile (alias `cp`) and selects its name as `profile_name`. */
export const PROFILE_NAME_COLUMN = 'cp.name AS profile_name';
export const PROFILE_JOIN = 'LEFT JOIN customer_profiles cp ON cp.chat_jid = c.jid';

/** WHERE clause: the chat has a tag with key `@tagKey`. */
export const TAG_FILTER =
  'EXISTS (SELECT 1 FROM customer_tags tg WHERE tg.chat_jid = c.jid AND tg.tag_key = @tagKey)';

/** WHERE alternatives for the inbox search over profile fields and tags (`@q`, LIKE-escaped with `\`). */
export const PROFILE_SEARCH = `cp.name LIKE @q ESCAPE '\\' OR cp.company LIKE @q ESCAPE '\\' OR cp.email LIKE @q ESCAPE '\\'
  OR cp.other_phone LIKE @q ESCAPE '\\' OR cp.address LIKE @q ESCAPE '\\'
  OR EXISTS (SELECT 1 FROM customer_tags tq WHERE tq.chat_jid = c.jid AND tq.tag LIKE @q ESCAPE '\\')`;

/** Tags of many chats in one query (saved order); chats without tags are absent. */
export function tagsByChat(db: DB, chatJids: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const jids = [...new Set(chatJids)];
  // Stay well below SQLite's bound-parameter limit.
  for (let i = 0; i < jids.length; i += 500) {
    const chunk = jids.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT chat_jid, tag FROM customer_tags WHERE chat_jid IN (${chunk.map(() => '?').join(', ')})
         ORDER BY created_at, rowid`,
      )
      .all(...chunk) as Array<{ chat_jid: string; tag: string }>;
    for (const r of rows) {
      const tags = out.get(r.chat_jid);
      if (tags) tags.push(r.tag);
      else out.set(r.chat_jid, [r.tag]);
    }
  }
  return out;
}

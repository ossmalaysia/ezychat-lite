import type { DB } from '../db/index.js';

/**
 * Hidden chats (docs/features/chat-hide-delete/design.md Part A), the small read side used by every
 * reader: a hidden chat (`chats.hidden_at` set) behaves like a chat that does not exist. Writes live
 * only in `chats/hide.ts`.
 */

/** SQL: the keys of every hidden chat (archived ones too); `x NOT IN (…)` leaves them out. */
export const HIDDEN_CHAT_KEYS = 'SELECT jid FROM chats WHERE hidden_at IS NOT NULL';

/** SQL condition on chat alias `c`: the chat is not hidden. */
export const visibleChat = (c: string): string => `${c}.hidden_at IS NULL`;

/** The error a send of a hidden chat fails with (it is never sent later, e.g. from another number). */
export const LOGGED_OUT_MESSAGE = 'This WhatsApp number was logged out';

/** True when the chat with this key exists and is hidden. */
export function isChatHidden(db: DB, jid: string): boolean {
  const r = db.prepare('SELECT hidden_at FROM chats WHERE jid = ?').get(jid) as
    { hidden_at: number | null } | undefined;
  return r?.hidden_at != null;
}

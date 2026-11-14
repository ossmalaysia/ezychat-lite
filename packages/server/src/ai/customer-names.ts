import type { DB } from '../db/index.js';
import { isPersonName } from './phrases/check.js';

/** Newest direct chats whose people's names no learned text may hold. */
export const NAMED_CHATS = 2_000;

export interface NamedRow {
  chatName: string | null;
  profileName: string | null;
}

/**
 * Every customer name of an inbox (chat and saved profile names, whole and word by word), plus the names of
 * `extra` rows, for `cleanTeamReply`: text the AI learns from never keeps a customer's name.
 */
export function inboxCustomerNames(
  db: DB,
  inboxId: number,
  extra: readonly NamedRow[] = [],
): string[] {
  const people = db
    .prepare(
      `SELECT c.name AS chatName, p.name AS profileName
         FROM chats c LEFT JOIN customer_profiles p ON p.chat_jid = c.jid
        WHERE c.inbox_id = ? AND c.type = 'dm'
        ORDER BY c.last_message_at DESC LIMIT ?`,
    )
    .all(inboxId, NAMED_CHATS) as NamedRow[];
  return [
    ...new Set(
      [...extra, ...people]
        .flatMap((r) => [r.chatName, r.profileName])
        .flatMap((n) => (n ? [n, ...n.split(/\s+/)] : [])),
    ),
  ].filter(isPersonName);
}

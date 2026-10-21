/**
 * Chat and message keys across inboxes. Inbox 1 (the number linked before multi-inbox) keeps the
 * plain WhatsApp JID / message id, so a Lite data dir needs no data move. Other inboxes append
 * `#<inboxId>`. `#` never occurs in a WhatsApp JID or message id.
 */
export const PRIMARY_INBOX_ID = 1;

const SUFFIX = /^[1-9]\d*$/;

function checkInboxId(inboxId: number): void {
  if (!Number.isInteger(inboxId) || inboxId < 1) throw new Error(`invalid inbox id: ${inboxId}`);
}

function join(inboxId: number, waValue: string, what: string): string {
  checkInboxId(inboxId);
  if (!waValue || waValue.includes('#')) throw new Error(`invalid WhatsApp ${what}`);
  return inboxId === PRIMARY_INBOX_ID ? waValue : `${waValue}#${inboxId}`;
}

function split(key: string, what: string): { inboxId: number; wa: string } {
  const parts = key.split('#');
  const wa = parts[0] ?? '';
  if (!wa || parts.length > 2) throw new Error(`invalid ${what} key`);
  if (parts.length === 1) return { inboxId: PRIMARY_INBOX_ID, wa };
  const suffix = parts[1]!;
  // inbox 1 never carries a suffix: `x#1` is not a key this code writes
  if (!SUFFIX.test(suffix) || suffix === '1') throw new Error(`invalid ${what} key`);
  return { inboxId: Number(suffix), wa };
}

/** The chat key of `waJid` in `inboxId` (`chats.jid`, `messages.chat_jid`, …). */
export function chatKey(inboxId: number, waJid: string): string {
  return join(inboxId, waJid, 'JID');
}

/** Inverse of chatKey; throws on a malformed key. */
export function parseChatKey(key: string): { inboxId: number; waJid: string } {
  const { inboxId, wa } = split(key, 'chat');
  return { inboxId, waJid: wa };
}

/** The stored message id of WhatsApp message `waId` received or sent through `inboxId`. */
export function messageKey(inboxId: number, waId: string): string {
  return join(inboxId, waId, 'message id');
}

/** The WhatsApp message id inside a stored message key; throws on a malformed key. */
export function waMessageId(key: string): string {
  return split(key, 'message').wa;
}

/** The inbox of a chat key or a message key. */
export function inboxOfKey(key: string): number {
  return split(key, 'chat').inboxId;
}

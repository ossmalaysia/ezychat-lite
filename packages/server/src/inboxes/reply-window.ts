import type { AppContext } from '../context.js';
import { HttpError } from '../http/errors.js';

/** Code of a free-form send refused because the chat's reply window closed (HTTP 409, queue error). */
export const WINDOW_CLOSED = 'window_closed';

export const WINDOW_CLOSED_MESSAGE =
  'The reply window of this chat is closed: only an approved template can be sent until the customer writes again';

export function windowClosedError(): HttpError {
  return new HttpError(409, WINDOW_CLOSED, WINDOW_CLOSED_MESSAGE);
}

/** True for a refusal (HttpError) or a failed queued send caused by a closed reply window. */
export function isWindowClosed(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === WINDOW_CLOSED || e.message === WINDOW_CLOSED;
}

/**
 * Whether free-form messages (text, media, voice notes, reactions) may go to a chat now: always,
 * unless the chat's inbox connection has a reply window (`replyWindowHours`, the WhatsApp Business
 * API); then only within that many hours of the customer's last live message. A chat of a removed or
 * unknown inbox answers true: the other send refusals cover it.
 */
export function replyWindowOpen(ctx: AppContext, chatKey: string, now = Date.now()): boolean {
  let hours: number | null;
  try {
    hours = ctx.inboxes.connections.forChatKey(chatKey).capabilities?.replyWindowHours ?? null;
  } catch {
    return true;
  }
  if (hours === null) return true;
  const row = ctx.db.prepare('SELECT last_inbound_at FROM chats WHERE jid = ?').get(chatKey) as
    { last_inbound_at: number | null } | undefined;
  const last = row?.last_inbound_at ?? null;
  return last !== null && last + hours * 3_600_000 > now;
}

import { createHash } from 'node:crypto';
import type { Message } from '@ezychat/shared';
import type { AppContext } from '../context.js';
import type { ApiPrincipal } from '../api-tokens/index.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../http/errors.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { getChats, getMessages } from '../wa-bridge/index.js';

/** Thrown for an expected failure of a send; its message is shown to the model. */
export class SendError extends Error {}

export interface SendResult {
  messageId: string;
  chatJid: string;
  status: Message['status'];
  /** WhatsApp is not connected: the send queue sends it when the link is back (or it expires). */
  queued: boolean;
  /** The same requestId was sent before: this is that message, nothing was sent again. */
  duplicate: boolean;
}

/**
 * The only write access MCP tools get: a text reply into an existing chat, as the token's owner, through
 * the normal message service (send queue, presence, retry, reply routing, moved-number guard, claim on
 * reply). Separate from InboxReadPort, so a read tool can never reach it; only `inbox:send` tools do.
 */
export interface InboxSendPort {
  sendText(
    principal: ApiPrincipal,
    input: { jid: string; text: string; requestId: string; quotedMessageId?: string },
  ): SendResult;
}

/** Per-token limits: a runaway assistant loop cannot flood customers. */
export const SEND_LIMITS = {
  perMinute: { windowMs: 60_000, max: 10 },
  perDay: { windowMs: 24 * 60 * 60_000, max: 100 },
} as const;

/** The message service's clientId for this token + requestId (≤ 64 chars, never reused by the inbox). */
export function sendClientId(tokenId: number, requestId: string): string {
  return 'mcp-' + createHash('sha256').update(`${tokenId}:${requestId}`).digest('hex').slice(0, 40);
}

export function createInboxSendPort(ctx: AppContext, deps?: { now?: () => number }): InboxSendPort {
  const chats = getChats(ctx);
  const messages = getMessages(ctx);
  const limiters = [
    { limiter: new WindowLimiter({ ...SEND_LIMITS.perMinute, now: deps?.now }), what: 'a minute' },
    { limiter: new WindowLimiter({ ...SEND_LIMITS.perDay, now: deps?.now }), what: 'a day' },
  ];

  return {
    sendText(principal, input) {
      if (!principal.scopes.has('inbox:send'))
        throw new SendError('This access token cannot send messages.');
      const resolved = chats.resolveJid(input.jid);
      const chat = chats.get(resolved);
      if (!chat)
        throw new SendError(
          `No chat found for ${input.jid}. Only existing chats can receive a message.`,
        );

      const clientId = sendClientId(principal.tokenId, input.requestId);
      let msg: Message;
      try {
        // A retried requestId returns the stored message without sending or counting it again.
        const before = messages.byClientId(clientId);
        if (!before) {
          for (const { limiter, what } of limiters) {
            const hit = limiter.hit(String(principal.tokenId));
            if (!hit.allowed)
              throw new SendError(
                `Too many messages from this token in ${what}; try again in ${hit.retryAfterSec} s.`,
              );
          }
        }
        msg = messages.sendText(
          chat.jid,
          { text: input.text, clientId, quotedId: input.quotedMessageId },
          principal.user.id,
        );
        if (before) {
          if (msg.chatJid !== chat.jid || msg.body !== input.text)
            throw new SendError(
              'This requestId was already used for a different message; use a new requestId.',
            );
          return result(msg, true);
        }
      } catch (err) {
        if (err instanceof SendError) throw err;
        // Expected checks of the message service (moved number, quote not in this chat, ...).
        if (err instanceof HttpError && err.status < 500) throw new SendError(err.message);
        throw err;
      }
      audit(ctx.db, {
        userId: principal.user.id,
        action: 'mcp.send',
        ip: null,
        // Never the text: which token sent which message into which chat.
        meta: { tokenId: principal.tokenId, chatJid: chat.jid, messageId: msg.id },
      });
      return result(msg, false);
    },
  };

  function result(msg: Message, duplicate: boolean): SendResult {
    return {
      messageId: msg.id,
      chatJid: msg.chatJid,
      status: msg.status,
      queued: ctx.wa.status.state !== 'open' && msg.status === 'pending',
      duplicate,
    };
  }
}

import type { ChatStatus } from '@ezychat/shared';
import type { AppContext } from '../context.js';
import type { ApiPrincipal } from '../api-tokens/index.js';
import { audit } from '../db/audit.js';
import { WindowLimiter } from '../http/window-limiter.js';
import { getChats } from '../wa-bridge/index.js';
import { ambiguousChat, findChats } from './inbox.js';

/** Thrown for an expected refusal of a chat change; its message is shown to the model. */
export class ManageError extends Error {}

export interface ChatChangeResult {
  chatId: string;
  status: ChatStatus;
  /** False when the chat already had this status (nothing changed, nothing audited). */
  changed: boolean;
  /** The same requestId was used before: this is that result, nothing was changed again. */
  duplicate: boolean;
  /** resolve_chat with a note: the note was added for the team. */
  noteAdded?: boolean;
}

/**
 * The only chat-changing access MCP tools get (scope `inbox:manage`): resolve or reopen an existing
 * chat as the token's owner, through the same chat service call as a teammate's Resolve / Reopen in
 * the app (events, sockets, assignment, AI side effects and Reports all follow from it). Never sends
 * anything to WhatsApp. Separate from InboxReadPort and InboxSendPort.
 */
export interface InboxManagePort {
  resolveChat(
    principal: ApiPrincipal,
    input: { chatId: string; requestId: string; note?: string },
  ): ChatChangeResult;
  reopenChat(
    principal: ApiPrincipal,
    input: { chatId: string; requestId: string },
  ): ChatChangeResult;
}

/**
 * Per-token limits. An owner triaging a backlog ("resolve the chats that just said thanks") does a
 * few dozen in a burst; 30 a minute allows that while a runaway loop stops within a minute. 300 a
 * day is above a busy small team's daily volume; a larger clean-up is Resolve all in the app.
 */
export const MANAGE_LIMITS = {
  perMinute: { windowMs: 60_000, max: 30 },
  perDay: { windowMs: 24 * 60 * 60_000, max: 300 },
} as const;

/** How long a requestId is remembered for a retry (in memory; a restart forgets it). */
const REQUEST_TTL_MS = 24 * 60 * 60_000;
/** Remembered requestIds per token: the day limit, so a token can never grow the map beyond it. */
const REQUESTS_PER_TOKEN = MANAGE_LIMITS.perDay.max;

type Action = 'resolve' | 'reopen';

interface Remembered {
  action: Action;
  chatId: string;
  result: ChatChangeResult;
  at: number;
}

export function createInboxManagePort(
  ctx: AppContext,
  deps?: { now?: () => number },
): InboxManagePort {
  const now = deps?.now ?? Date.now;
  const chats = getChats(ctx);
  const limiters = [
    { limiter: new WindowLimiter({ ...MANAGE_LIMITS.perMinute, now }), what: 'a minute' },
    { limiter: new WindowLimiter({ ...MANAGE_LIMITS.perDay, now }), what: 'a day' },
  ];
  /** tokenId → requestId → what that request did. */
  const requests = new Map<number, Map<string, Remembered>>();

  function remembered(tokenId: number, requestId: string): Remembered | undefined {
    const list = requests.get(tokenId);
    const hit = list?.get(requestId);
    if (hit && now() - hit.at > REQUEST_TTL_MS) {
      list!.delete(requestId);
      return undefined;
    }
    return hit;
  }

  function remember(tokenId: number, requestId: string, entry: Remembered) {
    let list = requests.get(tokenId);
    if (!list) requests.set(tokenId, (list = new Map()));
    list.set(requestId, entry);
    // oldest first (insertion order): drop expired and anything beyond the cap
    for (const [id, e] of list) {
      if (list.size <= REQUESTS_PER_TOKEN && now() - e.at <= REQUEST_TTL_MS) break;
      list.delete(id);
    }
  }

  /**
   * The existing chat the change goes to. A chat of an inbox the token owner may not open, or one
   * hidden on Log out, is "not found", never a hint it exists.
   */
  function targetChat(principal: ApiPrincipal, chatId: string): string {
    if (!principal.scopes.has('inbox:manage'))
      throw new ManageError('This access token cannot resolve or reopen chats.');
    const found = findChats(ctx, chatId, principal.user);
    if (found.length > 1) throw new ManageError(ambiguousChat(ctx, chatId, found));
    const chat = found[0];
    if (!chat) throw new ManageError(`No chat found for ${chatId}.`);
    return chat.jid;
  }

  function count(principal: ApiPrincipal) {
    for (const { limiter, what } of limiters) {
      const hit = limiter.hit(String(principal.tokenId));
      if (!hit.allowed)
        throw new ManageError(
          `Too many chat changes from this token in ${what}; try again in ${hit.retryAfterSec} s.`,
        );
    }
  }

  function change(
    principal: ApiPrincipal,
    action: Action,
    input: { chatId: string; requestId: string; note?: string },
  ): ChatChangeResult {
    const jid = targetChat(principal, input.chatId);
    const before = remembered(principal.tokenId, input.requestId);
    if (before) {
      if (before.action !== action || before.chatId !== jid)
        throw new ManageError(
          'This requestId was already used for a different change; use a new requestId.',
        );
      return { ...before.result, duplicate: true };
    }
    count(principal);
    const status: ChatStatus = action === 'resolve' ? 'resolved' : 'open';
    const cur = chats.get(jid);
    const changed = cur !== null && cur.status !== status;
    const userId = principal.user.id;
    let noteAdded: boolean | undefined;
    if (action === 'resolve' && input.note !== undefined) {
      // the app's Add note: a team note, never sent to WhatsApp
      chats.addNote(jid, userId, input.note);
      noteAdded = true;
    }
    // The app's Resolve / Reopen: the same call PATCH /api/chats/:jid makes for a teammate.
    const chat = chats.patch(jid, { status }, userId);
    if (changed) {
      audit(ctx.db, {
        userId,
        action: action === 'resolve' ? 'mcp.resolve' : 'mcp.reopen',
        ip: null,
        // Never the note or any message text: which token changed which chat.
        meta: { tokenId: principal.tokenId, chatJid: jid },
      });
    }
    const result: ChatChangeResult = {
      chatId: chat.jid,
      status: chat.status,
      changed,
      duplicate: false,
      ...(noteAdded ? { noteAdded } : {}),
    };
    remember(principal.tokenId, input.requestId, { action, chatId: jid, result, at: now() });
    return result;
  }

  return {
    resolveChat: (principal, input) => change(principal, 'resolve', input),
    reopenChat: (principal, input) => change(principal, 'reopen', input),
  };
}

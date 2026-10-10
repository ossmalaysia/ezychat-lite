import type {
  Chat,
  ChatEvent,
  ChatListQuery,
  Message,
  MessageListQuery,
  Note,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { getAuth } from '../auth/guards.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import { computeInboxActivity, type InboxActivity } from '../chats/activity.js';
import { computeInboxStats, type InboxStats } from '../chats/stats.js';
import { getChats, getMessages } from '../wa-bridge/index.js';

/**
 * The only inbox access MCP tools get: reads, no writes. A future write tool would get a separate
 * port behind its own token scope, so a read tool can never reach send/assign/resolve.
 */
export interface InboxReadPort {
  listChats(q: ChatListQuery, ownerId: number): { chats: Chat[]; nextCursor: string | null };
  /** Null when no chat matches (a phone-number or WhatsApp-ID form of a chat both resolve). */
  getChat(jid: string): { chat: Chat; events: ChatEvent[]; notes: Note[] } | null;
  listMessages(
    jid: string,
    q: MessageListQuery,
  ): { messages: Message[]; nextBefore: string | null } | null;
  stats(days: number): InboxStats;
  activity(days: number): InboxActivity;
  /** Display names of team members by id (including disabled ones and the AI member). */
  userNames(): Map<number, string>;
  /** Ids of AI members (the AI Sales Agent). */
  aiUserIds(): Set<number>;
}

export function createInboxReadPort(ctx: AppContext): InboxReadPort {
  const chats = getChats(ctx);
  const messages = getMessages(ctx);
  const auth = getAuth(ctx);
  const timeZone = () => resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
  const existing = (jid: string): string | null => {
    const resolved = chats.resolveJid(jid);
    return chats.get(resolved) ? resolved : null;
  };
  return {
    listChats: (q, ownerId) => chats.list(q, ownerId),
    getChat(jid) {
      const resolved = existing(jid);
      if (!resolved) return null;
      return {
        chat: chats.get(resolved)!,
        events: chats.events(resolved),
        notes: chats.listNotes(resolved),
      };
    },
    listMessages(jid, q) {
      const resolved = existing(jid);
      return resolved ? messages.list(resolved, q) : null;
    },
    stats: (days) => computeInboxStats(ctx.db, { days, timeZone: timeZone(), now: Date.now() }),
    activity: (days) =>
      computeInboxActivity(ctx.db, { days, timeZone: timeZone(), now: Date.now() }),
    userNames: () => new Map(auth.listUsers().map((u) => [u.id, u.displayName])),
    aiUserIds: () => new Set(auth.listUsers().flatMap((u) => (u.kind === 'ai' ? [u.id] : []))),
  };
}

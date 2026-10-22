import type {
  Chat,
  ChatEvent,
  ChatListQuery,
  Message,
  MessageListQuery,
  Note,
  User,
} from '@ezychat/shared';
import { normalizeNewChatPhone } from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { getAuth } from '../auth/guards.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import { computeInboxActivity, type InboxActivity } from '../chats/activity.js';
import { computeInboxStats, type InboxStats } from '../chats/stats.js';
import { canOpen, scopeFor, scopeIds, type InboxScope } from '../inboxes/access.js';
import { chatKey } from '../inboxes/keys.js';
import { getChats, getMessages } from '../wa-bridge/index.js';
import { ToolError } from './tools.js';

/** The user an inbox tool reads for: the token owner (their inbox scope applies). */
type Reader = Pick<User, 'id' | 'role' | 'kind'>;

/** An inbox (WhatsApp number) a reader may open. */
export interface InboxInfo {
  id: number;
  name: string;
  removed: boolean;
}

/** Counts of one active inbox, in `get_stats` when the reader has more than one. */
export interface InboxStatsRow {
  inboxId: number;
  name: string;
  open: number;
  resolved: number;
  waitingForReply: number;
  /** Customer and team messages over the period. */
  inbound: number;
  outbound: number;
}

/** Customer demand and first replies of one active inbox, in `get_activity`. */
export interface InboxActivityRow {
  inboxId: number;
  name: string;
  customerMessages: number;
  newConversations: number;
  teamReplies: number;
  firstReply: { answered: number; unanswered: number; median: number | null; p90: number | null };
}

/**
 * The only inbox access MCP tools get: reads, no writes. A future write tool would get a separate
 * port behind its own token scope, so a read tool can never reach send/assign/resolve. Every read
 * keeps to the reader's inbox scope: a chat of another inbox is "not found".
 */
export interface InboxReadPort {
  /** Inboxes the reader may open (admins: every inbox, removed ones too), by id. */
  inboxesFor(reader: Reader): InboxInfo[];
  /** `inboxId` narrows to one inbox; an inbox outside the scope is a ToolError. */
  listChats(
    q: ChatListQuery,
    reader: Reader,
    inboxId?: number,
  ): { chats: Chat[]; nextCursor: string | null };
  /** Null when no chat matches (a phone-number or WhatsApp-ID form of a chat both resolve). */
  getChat(jid: string, reader: Reader): { chat: Chat; events: ChatEvent[]; notes: Note[] } | null;
  listMessages(
    jid: string,
    q: MessageListQuery,
    reader: Reader,
  ): { messages: Message[]; nextBefore: string | null } | null;
  /** `byInbox` when no inbox is chosen and the reader has more than one active inbox. */
  stats(days: number, reader: Reader, inboxId?: number): InboxStats & { byInbox?: InboxStatsRow[] };
  activity(
    days: number,
    reader: Reader,
    inboxId?: number,
  ): InboxActivity & { byInbox?: InboxActivityRow[] };
  /** Display names of team members by id (including disabled ones and the AI member). */
  userNames(): Map<number, string>;
  /** Ids of AI members (the AI Sales Agent). */
  aiUserIds(): Set<number>;
}

const sum = <T>(rows: readonly T[], pick: (r: T) => number) =>
  rows.reduce((total, r) => total + pick(r), 0);

/**
 * The chats a tool's `jid` input names inside the reader's scope. A chat key (as list_chats returns
 * it: inbox 1's plain JID, `…#<inboxId>` for the others) names one chat. A phone number or a WhatsApp
 * JID that is not a chat key is looked up in every active inbox in scope: it can name a chat in
 * several inboxes, and the caller must then ask for the chat key (`ambiguousChat`).
 */
export function findChats(ctx: AppContext, jid: string, reader: Reader): Chat[] {
  const chats = getChats(ctx);
  const scope = scopeFor(ctx, reader);
  const inScope = (c: Chat | null): c is Chat => c !== null && canOpen(scope, c.inboxId);
  const exact = chats.get(jid);
  if (jid.includes('#')) return inScope(exact) ? [exact] : [];
  if (exact?.jid === jid && inScope(exact)) return [exact];
  const phone = jid.includes('@') ? null : normalizeNewChatPhone(jid);
  const waJid = phone ? `${phone}@s.whatsapp.net` : jid;
  const found = new Map<string, Chat>();
  for (const id of scopeIds(ctx, scope)) {
    let chat: Chat | null;
    try {
      chat = chats.get(chatKey(id, waJid));
    } catch {
      continue; // not a WhatsApp JID
    }
    if (inScope(chat) && chat.inboxId === id) found.set(chat.jid, chat);
  }
  return [...found.values()];
}

/** The message for a phone or JID that has a chat in more than one inbox. */
export function ambiguousChat(ctx: AppContext, jid: string, found: readonly Chat[]): string {
  const list = found
    .map(
      (c) => `${c.jid} (inbox ${c.inboxId}, ${ctx.inboxes.repo.get(c.inboxId)?.name ?? 'removed'})`,
    )
    .join(', ');
  return (
    `inbox_required: ${jid} has a chat in more than one inbox (WhatsApp number); pass the chat ` +
    `id of the one you mean: ${list}.`
  );
}

/** The one chat `jid` names in the reader's scope, null when none; a ToolError when several. */
function oneChat(ctx: AppContext, jid: string, reader: Reader): Chat | null {
  const found = findChats(ctx, jid, reader);
  if (found.length > 1) throw new ToolError(ambiguousChat(ctx, jid, found));
  return found[0] ?? null;
}

export function createInboxReadPort(ctx: AppContext): InboxReadPort {
  const chats = getChats(ctx);
  const messages = getMessages(ctx);
  const auth = getAuth(ctx);
  const timeZone = () => resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));

  const inboxesIn = (scope: InboxScope): InboxInfo[] =>
    ctx.inboxes.repo
      .list()
      .filter((r) => canOpen(scope, r.id))
      .map((r) => ({ id: r.id, name: r.name, removed: r.removed_at !== null }));

  /**
   * The inboxes a read covers: `undefined` = every inbox (an admin's 'all', removed ones too),
   * else the ids in the scope, or only `inboxId` when it is chosen.
   */
  function cover(reader: Reader, inboxId?: number) {
    const scope = scopeFor(ctx, reader);
    if (inboxId !== undefined && (!canOpen(scope, inboxId) || !ctx.inboxes.repo.get(inboxId)))
      throw noInbox(inboxId, scope);
    const inboxIds = inboxId !== undefined ? [inboxId] : scope === 'all' ? undefined : [...scope];
    // byInbox only for a whole-scope read over more than one active inbox
    const breakdown = inboxId === undefined ? scopeIds(ctx, scope) : [];
    return { scope, inboxIds, breakdown: breakdown.length > 1 ? breakdown : [] };
  }

  function noInbox(inboxId: number, scope: InboxScope): ToolError {
    const known = inboxesIn(scope)
      .map((i) => `${i.id} (${i.name})`)
      .join(', ');
    return new ToolError(`No inbox ${inboxId}. Inboxes: ${known}.`);
  }

  const nameOf = (id: number) => ctx.inboxes.repo.get(id)?.name ?? `inbox ${id}`;
  const statsOf = (days: number, inboxIds?: readonly number[]) =>
    computeInboxStats(ctx.db, { days, timeZone: timeZone(), now: Date.now(), inboxIds });
  const activityOf = (days: number, inboxIds?: readonly number[]) =>
    computeInboxActivity(ctx.db, { days, timeZone: timeZone(), now: Date.now(), inboxIds });

  return {
    inboxesFor: (reader) => inboxesIn(scopeFor(ctx, reader)),
    listChats(q, reader, inboxId) {
      const { inboxIds } = cover(reader, inboxId);
      return chats.list(q, reader.id, { inboxIds, inbox: inboxId });
    },
    getChat(jid, reader) {
      const chat = oneChat(ctx, jid, reader);
      if (!chat) return null;
      return { chat, events: chats.events(chat.jid), notes: chats.listNotes(chat.jid) };
    },
    listMessages(jid, q, reader) {
      const chat = oneChat(ctx, jid, reader);
      return chat ? messages.list(chat.jid, q) : null;
    },
    stats(days, reader, inboxId) {
      const { inboxIds, breakdown } = cover(reader, inboxId);
      const total = statsOf(days, inboxIds);
      if (!breakdown.length) return total;
      const byInbox = breakdown.map((id): InboxStatsRow => {
        const s = statsOf(days, [id]);
        return {
          inboxId: id,
          name: nameOf(id),
          open: s.chats.open,
          resolved: s.chats.resolved,
          waitingForReply: s.waitingForReply.count,
          inbound: sum(s.daily, (d) => d.inbound),
          outbound: sum(s.daily, (d) => d.outbound),
        };
      });
      return { ...total, byInbox };
    },
    activity(days, reader, inboxId) {
      const { inboxIds, breakdown } = cover(reader, inboxId);
      const total = activityOf(days, inboxIds);
      if (!breakdown.length) return total;
      const byInbox = breakdown.map((id): InboxActivityRow => {
        const a = activityOf(days, [id]);
        return {
          inboxId: id,
          name: nameOf(id),
          customerMessages: sum(a.byHour, (h) => h.customerMessages),
          newConversations: sum(a.byHour, (h) => h.newConversations),
          teamReplies: sum(a.byHour, (h) => h.teamReplies),
          firstReply: {
            answered: a.firstReply.answered,
            unanswered: a.firstReply.unanswered,
            median: a.firstReply.median,
            p90: a.firstReply.p90,
          },
        };
      });
      return { ...total, byInbox };
    },
    userNames: () =>
      new Map(auth.listUsers({ includeDeleted: true }).map((u) => [u.id, u.displayName])),
    aiUserIds: () =>
      new Set(
        auth.listUsers({ includeDeleted: true }).flatMap((u) => (u.kind === 'ai' ? [u.id] : [])),
      ),
  };
}

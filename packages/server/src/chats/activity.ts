import type { DB } from '../db/index.js';
import { inboxCondition, localClock, localDate, localMidnight } from './stats.js';

/** A customer message after this much silence in its chat starts a new conversation. */
export const CONVERSATION_GAP_MS = 12 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

interface Counts {
  customerMessages: number;
  newConversations: number;
  teamReplies: number;
}

/** Who sent a team message: a member (human or the AI member), or `null` = the phone itself. */
export interface ResponderStats {
  userId: number | null;
  /** Team messages sent, in total and per local hour (index = hour 0-23). */
  messages: number;
  messagesByHour: number[];
  /** Distinct chats it sent at least one message in. */
  chats: number;
  /** Waits it ended (the first team reply after a customer wrote). */
  firstReplies: number;
  firstReplyMinutes: { median: number | null; p90: number | null };
}

/** When customers write and who answers, in the business time zone (MCP `get_activity`). */
export interface InboxActivity {
  timeZone: string;
  /** Local midnight `days - 1` days ago up to now. */
  from: number;
  to: number;
  byHour: Array<{ hour: number } & Counts>;
  byWeekday: Array<{ weekday: (typeof WEEKDAYS)[number] } & Counts>;
  /** New conversations per weekday (Mon first), each a row of 24 hourly counts. */
  newConversationsHeatmap: Record<(typeof WEEKDAYS)[number], number[]>;
  /** Waits that started in the period, by the local hour the customer wrote. */
  firstReply: {
    answered: number;
    unanswered: number;
    median: number | null;
    p90: number | null;
    byHour: Array<{
      hour: number;
      answered: number;
      unanswered: number;
      median: number | null;
    }>;
  };
  responders: ResponderStats[];
}

interface Row {
  chat_jid: string;
  from_me: 0 | 1;
  sent_by_user_id: number | null;
  timestamp: number;
}

/** Percentile `p` (0-1) of minutes, one decimal; null when empty. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const v = sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return Math.round(v * 10) / 10;
}

const summary = (minutes: number[]) => {
  const s = [...minutes].sort((a, b) => a - b);
  return { median: percentile(s, 0.5), p90: percentile(s, 0.9) };
};

const zeroCounts = (): Counts => ({ customerMessages: 0, newConversations: 0, teamReplies: 0 });

export function computeInboxActivity(
  db: DB,
  opts: {
    days: number;
    timeZone: string;
    now: number;
    /** Only chats of these inboxes (the caller's scope); omitted = every inbox. */
    inboxIds?: readonly number[];
  },
): InboxActivity {
  const startOfToday = localMidnight(localDate(opts.now, opts.timeZone), opts.timeZone);
  const from = localMidnight(
    localDate(startOfToday - (opts.days - 1) * DAY_MS + DAY_MS / 2, opts.timeZone),
    opts.timeZone,
  );

  // Direct chats only (group chatter is not customer demand); failed and unsent team messages
  // never reached the customer. WhatsApp timestamps are whole seconds, so a quick reply can tie
  // with the customer message: ties keep the order messages were stored in (rowid), not the id.
  const counted = `m.type != 'system' AND NOT (m.from_me = 1 AND m.status IN ('failed', 'pending'))`;
  // Messages up to one gap before `from` decide whether the first customer message in the period
  // starts a conversation.
  const lookback = from - CONVERSATION_GAP_MS;
  const rows = db
    .prepare(
      `SELECT m.chat_jid, m.from_me, m.sent_by_user_id, m.timestamp FROM messages m
       JOIN chats c ON c.jid = m.chat_jid
       WHERE c.type = 'dm' AND ${inboxCondition('c', opts.inboxIds)} AND ${counted}
         AND m.timestamp >= ? AND m.timestamp <= ?
       ORDER BY m.chat_jid, m.timestamp, m.rowid`,
    )
    .all(lookback, opts.now) as Row[];
  // A wait can be open for longer than the lookback: per chat, the first customer message after
  // the last team reply before it (from the whole history). Only chats with messages in the period
  // need it, and each look-up walks the (chat_jid, timestamp) index instead of the whole history.
  const lastReply = db.prepare(
    `SELECT m.timestamp AS t, m.rowid AS r FROM messages m
     WHERE m.chat_jid = ? AND m.from_me = 1 AND ${counted} AND m.timestamp < ?
     ORDER BY m.timestamp DESC, m.rowid DESC LIMIT 1`,
  );
  // The lower bound (the last reply's time, or -1) lets SQLite walk only that slice of the index.
  const firstWaiting = db.prepare(
    `SELECT MIN(m.timestamp) AS since FROM messages m
     WHERE m.chat_jid = ? AND m.from_me = 0 AND ${counted} AND m.timestamp >= ? AND m.timestamp < ?
       AND (? IS NULL OR m.timestamp > ? OR (m.timestamp = ? AND m.rowid > ?))`,
  );
  const openWaits = new Map<string, number>();
  for (const chat of new Set(rows.map((r) => r.chat_jid))) {
    const reply = lastReply.get(chat, lookback) as { t: number; r: number } | undefined;
    const t = reply?.t ?? null;
    const { since } = firstWaiting.get(chat, t ?? -1, lookback, t, t, t, reply?.r ?? null) as {
      since: number | null;
    };
    if (since !== null) openWaits.set(chat, since);
  }

  const local = localClock(opts.timeZone);

  const byHour = Array.from({ length: 24 }, zeroCounts);
  const byWeekday = Array.from({ length: 7 }, zeroCounts);
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const waitHours = Array.from({ length: 24 }, () => ({ minutes: [] as number[], unanswered: 0 }));
  const allWaits: number[] = [];
  const responders = new Map<
    number | null,
    { messages: number; byHour: number[]; chats: Set<string>; waits: number[] }
  >();
  const responder = (id: number | null) => {
    let r = responders.get(id);
    if (!r) {
      r = { messages: 0, byHour: new Array<number>(24).fill(0), chats: new Set(), waits: [] };
      responders.set(id, r);
    }
    return r;
  };

  let chat = '';
  let previousAt: number | null = null;
  /** Start of the current wait (first customer message since the last team reply). */
  let waitingSince: number | null = null;
  const closeChat = () => {
    if (waitingSince !== null && waitingSince >= from)
      waitHours[local(waitingSince).hour]!.unanswered++;
  };

  for (const m of rows) {
    if (m.chat_jid !== chat) {
      closeChat();
      chat = m.chat_jid;
      previousAt = null;
      waitingSince = openWaits.get(chat) ?? null;
    }
    const inPeriod = m.timestamp >= from;
    const at = inPeriod ? local(m.timestamp) : null;
    if (m.from_me === 0) {
      if (at) {
        byHour[at.hour]!.customerMessages++;
        byWeekday[at.weekday]!.customerMessages++;
        if (previousAt === null || m.timestamp - previousAt > CONVERSATION_GAP_MS) {
          byHour[at.hour]!.newConversations++;
          byWeekday[at.weekday]!.newConversations++;
          heatmap[at.weekday]![at.hour]!++;
        }
      }
      waitingSince ??= m.timestamp;
    } else {
      if (at) {
        byHour[at.hour]!.teamReplies++;
        byWeekday[at.weekday]!.teamReplies++;
        const r = responder(m.sent_by_user_id);
        r.messages++;
        r.byHour[at.hour]!++;
        r.chats.add(m.chat_jid);
      }
      if (waitingSince !== null && waitingSince >= from) {
        const minutes = (m.timestamp - waitingSince) / 60_000;
        waitHours[local(waitingSince).hour]!.minutes.push(minutes);
        allWaits.push(minutes);
        responder(m.sent_by_user_id).waits.push(minutes);
      }
      waitingSince = null;
    }
    previousAt = m.timestamp;
  }
  closeChat();

  const unanswered = waitHours.reduce((n, h) => n + h.unanswered, 0);
  return {
    timeZone: opts.timeZone,
    from,
    to: opts.now,
    byHour: byHour.map((c, hour) => ({ hour, ...c })),
    byWeekday: byWeekday.map((c, i) => ({ weekday: WEEKDAYS[i]!, ...c })),
    newConversationsHeatmap: Object.fromEntries(
      WEEKDAYS.map((d, i) => [d, heatmap[i]!]),
    ) as InboxActivity['newConversationsHeatmap'],
    firstReply: {
      answered: allWaits.length,
      unanswered,
      ...summary(allWaits),
      byHour: waitHours.map((h, hour) => ({
        hour,
        answered: h.minutes.length,
        unanswered: h.unanswered,
        median: summary(h.minutes).median,
      })),
    },
    responders: [...responders.entries()]
      .map(([userId, r]) => ({
        userId,
        messages: r.messages,
        messagesByHour: r.byHour,
        chats: r.chats.size,
        firstReplies: r.waits.length,
        firstReplyMinutes: summary(r.waits),
      }))
      .sort((a, b) => b.messages - a.messages),
  };
}

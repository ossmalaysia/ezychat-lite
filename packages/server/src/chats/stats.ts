import type { DB } from '../db/index.js';

/** Read-only inbox counts for owner analysis (MCP `get_stats`). */
export interface InboxStats {
  timeZone: string;
  chats: { open: number; resolved: number };
  /** Open chats per assignee; `userId` null = unassigned. */
  openByAssignee: Array<{ userId: number | null; count: number }>;
  /** Open chats whose newest message is from the customer (nobody has replied yet). */
  waitingForReply: { count: number; oldestCustomerMessageAt: number | null };
  /** One row per local day, oldest first; today is the last row and is partial. */
  daily: Array<{ date: string; activeChats: number; inbound: number; outbound: number }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offset of `timeZone` from UTC at instant `t`, in ms (positive east of UTC). */
function zoneOffset(t: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(t)
      .map((p) => [p.type, Number(p.value)]),
  );
  const local = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return local - Math.floor(t / 1000) * 1000;
}

/** `YYYY-MM-DD` of instant `t` in `timeZone`. */
export function localDate(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
}

const CLOCK_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Every time-zone offset is a multiple of 15 minutes, so one lookup serves each quarter hour. */
const QUARTER_HOUR_MS = 15 * 60 * 1000;

/**
 * Local hour (0–23) and weekday (0 = Monday) of an instant in `timeZone`. `Intl` formatting is slow,
 * so results are kept per quarter hour: a report over many messages formats each quarter hour once.
 */
export function localClock(timeZone: string): (t: number) => { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const seen = new Map<number, { hour: number; weekday: number }>();
  return (t) => {
    const key = Math.floor(t / QUARTER_HOUR_MS);
    let hit = seen.get(key);
    if (!hit) {
      let hour = 0;
      let weekday = 0;
      for (const p of parts.formatToParts(key * QUARTER_HOUR_MS)) {
        if (p.type === 'hour') hour = Number(p.value);
        else if (p.type === 'weekday') weekday = CLOCK_WEEKDAYS.indexOf(p.value);
      }
      hit = { hour, weekday };
      seen.set(key, hit);
    }
    return hit;
  };
}

/** UTC instant of local midnight starting `date` (`YYYY-MM-DD`) in `timeZone`. */
export function localMidnight(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // Re-evaluate the offset at the first estimate so a DST change on that day lands correctly.
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone);
}

/**
 * SQL condition: chat alias `c` is in one of `inboxIds` (omitted = every inbox, empty = none).
 * Inbox ids are checked integers, so they are written into the SQL as literals.
 */
export function inboxCondition(c: string, inboxIds?: readonly number[]): string {
  if (!inboxIds) return '1 = 1';
  for (const id of inboxIds)
    if (!Number.isInteger(id) || id < 1) throw new Error(`invalid inbox id: ${id}`);
  return `${c}.inbox_id IN (${inboxIds.join(', ')})`;
}

export function computeInboxStats(
  db: DB,
  opts: {
    days: number;
    timeZone: string;
    now: number;
    /** Only chats of these inboxes (the caller's scope); omitted = every inbox. */
    inboxIds?: readonly number[];
  },
): InboxStats {
  const inScope = inboxCondition('c', opts.inboxIds);
  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS n FROM chats c WHERE ${inScope} GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;
  const count = (status: string) => byStatus.find((r) => r.status === status)?.n ?? 0;

  const openByAssignee = (
    db
      .prepare(
        `SELECT assigned_to AS userId, COUNT(*) AS count FROM chats c
         WHERE status = 'open' AND ${inScope}
         GROUP BY assigned_to ORDER BY count DESC`,
      )
      .all() as Array<{ userId: number | null; count: number }>
  ).map((r) => ({ userId: r.userId, count: r.count }));

  // Newest non-system message per open chat, via the (chat_jid, timestamp, id) index.
  const waiting = db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(last_at) AS oldest FROM (
         SELECT (SELECT m.from_me FROM messages m WHERE m.chat_jid = c.jid AND m.type != 'system'
                 ORDER BY m.timestamp DESC, m.id DESC LIMIT 1) AS last_from_me,
                (SELECT m.timestamp FROM messages m WHERE m.chat_jid = c.jid AND m.type != 'system'
                 ORDER BY m.timestamp DESC, m.id DESC LIMIT 1) AS last_at
         FROM chats c WHERE c.status = 'open' AND ${inScope}
       ) WHERE last_from_me = 0`,
    )
    .get() as { n: number; oldest: number | null };

  const dayQuery = db.prepare(
    `SELECT COUNT(DISTINCT chat_jid) AS activeChats,
            COALESCE(SUM(from_me = 0), 0) AS inbound,
            COALESCE(SUM(from_me = 1), 0) AS outbound
     FROM messages WHERE timestamp >= ? AND timestamp < ? AND type != 'system'${
       opts.inboxIds ? ` AND chat_jid IN (SELECT c.jid FROM chats c WHERE ${inScope})` : ''
     }`,
  );
  // Local days are 23-25 h long, so +1.5 days from today's midnight always lands in tomorrow and
  // -0.5 days from a midnight always lands in the previous day.
  const startOfToday = localMidnight(localDate(opts.now, opts.timeZone), opts.timeZone);
  let end = localMidnight(localDate(startOfToday + DAY_MS * 1.5, opts.timeZone), opts.timeZone);
  const daily: InboxStats['daily'] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = localDate(end - DAY_MS / 2, opts.timeZone);
    const start = localMidnight(date, opts.timeZone);
    const row = dayQuery.get(start, end) as {
      activeChats: number;
      inbound: number;
      outbound: number;
    };
    daily.unshift({ date, ...row });
    end = start;
  }

  return {
    timeZone: opts.timeZone,
    chats: { open: count('open'), resolved: count('resolved') },
    openByAssignee,
    waitingForReply: { count: waiting.n, oldestCustomerMessageAt: waiting.oldest },
    daily,
  };
}

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

/** UTC instant of local midnight starting `date` (`YYYY-MM-DD`) in `timeZone`. */
export function localMidnight(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // Re-evaluate the offset at the first estimate so a DST change on that day lands correctly.
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone);
}

export function computeInboxStats(
  db: DB,
  opts: { days: number; timeZone: string; now: number },
): InboxStats {
  const byStatus = db
    .prepare('SELECT status, COUNT(*) AS n FROM chats GROUP BY status')
    .all() as Array<{ status: string; n: number }>;
  const count = (status: string) => byStatus.find((r) => r.status === status)?.n ?? 0;

  const openByAssignee = (
    db
      .prepare(
        `SELECT assigned_to AS userId, COUNT(*) AS count FROM chats WHERE status = 'open'
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
         FROM chats c WHERE c.status = 'open'
       ) WHERE last_from_me = 0`,
    )
    .get() as { n: number; oldest: number | null };

  const dayQuery = db.prepare(
    `SELECT COUNT(DISTINCT chat_jid) AS activeChats,
            COALESCE(SUM(from_me = 0), 0) AS inbound,
            COALESCE(SUM(from_me = 1), 0) AS outbound
     FROM messages WHERE timestamp >= ? AND timestamp < ? AND type != 'system'`,
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

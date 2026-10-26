import {
  BookingSettings,
  DEFAULT_BOOKING_SETTINGS,
  type CalendarActivity,
  type CalendarActivityKind,
} from '@ezychat/shared';
import type { DB } from '../../db/index.js';

/** The only SQL of the Google Calendar connector (migration 022). */

/** An offer stays bookable this long. */
export const OFFER_TTL_MS = 24 * 3_600_000;
export const ACTIVITY_LIMIT = 50;
/** Bookings tab: the next 100 bookings and the past 30 days (at most 50). */
export const UPCOMING_LIMIT = 100;
export const PAST_LIMIT = 50;
export const PAST_DAYS_MS = 30 * 86_400_000;

export interface BookingRow {
  id: number;
  agentId: number;
  agentName: string;
  chatJid: string;
  customer: string;
  eventId: string;
  calendarId: string;
  start: number;
  end: number;
  createdAt: number;
}

/**
 * The events the AI added: `upcoming` (not ended yet) soonest first, `past` (ended in the last 30
 * days) newest first. Names from the agent's user row and the chat (saved name first).
 */
export function listBookings(db: DB, now: number): { upcoming: BookingRow[]; past: BookingRow[] } {
  const select = `SELECT b.id, b.agent_id AS agentId, COALESCE(u.display_name, '') AS agentName,
         b.chat_jid AS chatJid, COALESCE(NULLIF(TRIM(p.name), ''), c.name, '') AS customer,
         b.event_id AS eventId, b.calendar_id AS calendarId, b.start_at AS start, b.end_at AS end,
         b.created_at AS createdAt
       FROM calendar_bookings b
       LEFT JOIN ai_agents g ON g.id = b.agent_id
       LEFT JOIN users u ON u.id = g.user_id
       LEFT JOIN chats c ON c.jid = b.chat_jid
       LEFT JOIN customer_profiles p ON p.chat_jid = b.chat_jid`;
  const upcoming = db
    .prepare(`${select} WHERE b.end_at > ? ORDER BY b.start_at, b.id LIMIT ?`)
    .all(now, UPCOMING_LIMIT) as BookingRow[];
  const past = db
    .prepare(
      `${select} WHERE b.end_at <= ? AND b.end_at > ? ORDER BY b.start_at DESC, b.id DESC LIMIT ?`,
    )
    .all(now, now - PAST_DAYS_MS, PAST_LIMIT) as BookingRow[];
  return { upcoming, past };
}

export function readSettings(db: DB, agentId: number): BookingSettings {
  const row = db
    .prepare('SELECT settings FROM calendar_agent_settings WHERE agent_id = ?')
    .get(agentId) as { settings: string } | undefined;
  if (!row) return { ...DEFAULT_BOOKING_SETTINGS };
  try {
    const parsed = BookingSettings.safeParse(JSON.parse(row.settings));
    return parsed.success ? parsed.data : { ...DEFAULT_BOOKING_SETTINGS };
  } catch {
    return { ...DEFAULT_BOOKING_SETTINGS };
  }
}

export function writeSettings(db: DB, agentId: number, settings: BookingSettings, now: number) {
  db.prepare(
    `INSERT INTO calendar_agent_settings (agent_id, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
  ).run(agentId, JSON.stringify(settings), now);
}

export function recordOffers(
  db: DB,
  agentId: number,
  chatJid: string,
  slots: ReadonlyArray<{ start: number; end: number }>,
  now: number,
) {
  const insert = db.prepare(
    'INSERT INTO calendar_offers (agent_id, chat_jid, start_at, end_at, offered_at) VALUES (?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    // Old offers are never bookable again: keep the table small.
    db.prepare('DELETE FROM calendar_offers WHERE offered_at < ?').run(now - OFFER_TTL_MS);
    for (const slot of slots) insert.run(agentId, chatJid, slot.start, slot.end, now);
  })();
}

/**
 * The still-valid offers of this exact time in this chat by this agent, newest first. The AI may
 * check free times again in the turn that books, so a newer offer can follow the customer's answer.
 */
export function findOffers(
  db: DB,
  agentId: number,
  chatJid: string,
  start: number,
  now: number,
): { start: number; end: number; offeredAt: number }[] {
  return db
    .prepare(
      `SELECT start_at AS start, end_at AS end, offered_at AS offeredAt FROM calendar_offers
       WHERE agent_id = ? AND chat_jid = ? AND start_at = ? AND offered_at >= ?
       ORDER BY offered_at DESC, id DESC`,
    )
    .all(agentId, chatJid, start, now - OFFER_TTL_MS) as {
    start: number;
    end: number;
    offeredAt: number;
  }[];
}

/** The customer's latest offer time in this chat within 24 h (for the hand-over line), or null. */
export function lastOffer(
  db: DB,
  chatJid: string,
  now: number,
): { agentId: number; offeredAt: number } | null {
  const row = db
    .prepare(
      `SELECT agent_id AS agentId, offered_at AS offeredAt FROM calendar_offers
       WHERE chat_jid = ? AND offered_at >= ? ORDER BY offered_at DESC, id DESC LIMIT 1`,
    )
    .get(chatJid, now - OFFER_TTL_MS) as { agentId: number; offeredAt: number } | undefined;
  return row ?? null;
}

/** The customer's own recent messages in this chat (text and voice transcripts), newest first. */
export function customerTexts(db: DB, chatJid: string, limit = 200): string[] {
  return (
    db
      .prepare(
        `SELECT COALESCE(body, '') || ' ' || COALESCE(transcript, '') AS text FROM messages
         WHERE chat_jid = ? AND from_me = 0 ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(chatJid, limit) as Array<{ text: string }>
  ).map((row) => row.text);
}

export function customerRepliedSince(db: DB, chatJid: string, since: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM messages WHERE chat_jid = ? AND from_me = 0 AND timestamp > ? LIMIT 1')
    .get(chatJid, since);
}

export function hasBooking(db: DB, chatJid: string, start: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM calendar_bookings WHERE chat_jid = ? AND start_at = ?')
    .get(chatJid, start);
}

export function bookedSince(db: DB, chatJid: string, since: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM calendar_bookings WHERE chat_jid = ? AND created_at >= ? LIMIT 1')
    .get(chatJid, since);
}

export function insertBooking(
  db: DB,
  row: {
    agentId: number;
    chatJid: string;
    eventId: string;
    calendarId: string;
    start: number;
    end: number;
  },
  now: number,
) {
  db.prepare(
    `INSERT OR IGNORE INTO calendar_bookings (agent_id, chat_jid, event_id, calendar_id, start_at, end_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.agentId, row.chatJid, row.eventId, row.calendarId, row.start, row.end, now);
}

export function addActivity(
  db: DB,
  row: {
    kind: CalendarActivityKind;
    agentId: number | null;
    chatJid: string | null;
    start?: number | null;
    end?: number | null;
  },
  now: number,
) {
  db.prepare(
    'INSERT INTO calendar_activity (kind, agent_id, chat_jid, start_at, end_at, at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(row.kind, row.agentId, row.chatJid, row.start ?? null, row.end ?? null, now);
}

export function handedOverSince(db: DB, chatJid: string, since: number): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM calendar_activity WHERE chat_jid = ? AND kind = 'handed_over' AND at >= ? LIMIT 1",
    )
    .get(chatJid, since);
}

interface ActivityRow {
  id: number;
  at: number;
  kind: CalendarActivityKind;
  agentId: number | null;
  agentName: string | null;
  chatJid: string | null;
  chatName: string | null;
  profileName: string | null;
  start: number | null;
  end: number | null;
}

/** Newest first, at most 50; names from the agent's user row and the chat (saved name first). */
export function listActivity(db: DB): CalendarActivity[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.kind, a.agent_id AS agentId, u.display_name AS agentName,
              a.chat_jid AS chatJid, c.name AS chatName, p.name AS profileName,
              a.start_at AS start, a.end_at AS end
       FROM calendar_activity a
       LEFT JOIN ai_agents g ON g.id = a.agent_id
       LEFT JOIN users u ON u.id = g.user_id
       LEFT JOIN chats c ON c.jid = a.chat_jid
       LEFT JOIN customer_profiles p ON p.chat_jid = a.chat_jid
       ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    )
    .all(ACTIVITY_LIMIT) as ActivityRow[];
  const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    agentId: row.agentId,
    agentName: row.agentName ?? '',
    chatJid: row.chatJid,
    customer: row.profileName?.trim() || row.chatName || '',
    start: iso(row.start),
    end: iso(row.end),
  }));
}

/** chats/merge.ts: moves every calendar row of chat `from` to `to` (inside its transaction). */
export function mergeCalendarRows(db: DB, from: string, to: string): number {
  let moved = 0;
  moved += db
    .prepare('UPDATE calendar_offers SET chat_jid = ? WHERE chat_jid = ?')
    .run(to, from).changes;
  moved += db
    .prepare('UPDATE OR IGNORE calendar_bookings SET chat_jid = ? WHERE chat_jid = ?')
    .run(to, from).changes;
  // The same time booked in both chats: `to` already holds it.
  db.prepare('DELETE FROM calendar_bookings WHERE chat_jid = ?').run(from);
  moved += db
    .prepare('UPDATE calendar_activity SET chat_jid = ? WHERE chat_jid = ?')
    .run(to, from).changes;
  return moved;
}

import { z } from 'zod';

/**
 * Connectors (design: docs/features/google-calendar/design.md). Admin → Connectors is a gallery of
 * ready connectors; each has its own page. The first working one is Google Calendar: the AI agent
 * checks free times and, when an admin allows it, books the time the customer confirmed.
 */

/**
 * `not_configured`: this build has no Google sign-in app (no client id), so Connect is unavailable.
 * `expired`: Google refused the saved sign-in; `unavailable`: Google could not be reached lately.
 */
export const GoogleCalendarState = z.enum([
  'not_configured',
  'disconnected',
  'connected',
  'expired',
  'unavailable',
]);
export type GoogleCalendarState = z.infer<typeof GoogleCalendarState>;

export const GoogleCalendarItem = z.object({
  id: z.string(),
  name: z.string(),
  /** The account's own calendar. */
  primary: z.boolean(),
  /** Google only lets us read it (e.g. public holidays): never offered for bookings. */
  readOnly: z.boolean(),
});
export type GoogleCalendarItem = z.infer<typeof GoogleCalendarItem>;

/** `GET /api/connectors/google-calendar` (admins). Tokens are never sent to the browser. */
export const GoogleCalendarStatus = z.object({
  state: GoogleCalendarState,
  account: z.string().nullable(),
  calendars: z.array(GoogleCalendarItem),
  connectedAt: z.number().int().nullable(),
  /** When it stopped working (expired/unavailable), else null. */
  problemSince: z.number().int().nullable(),
});
export type GoogleCalendarStatus = z.infer<typeof GoogleCalendarStatus>;

/** `POST /api/connectors/google-calendar/connect`: open `authorizationUrl` in a new window. */
export const GoogleCalendarConnectStart = z.object({
  requestId: z.string(),
  authorizationUrl: z.string().url(),
});
export type GoogleCalendarConnectStart = z.infer<typeof GoogleCalendarConnectStart>;

/** `GET /api/connectors/google-calendar/connect/:requestId`: the page polls until done or failed. */
export const GoogleCalendarConnectProgress = z.object({
  status: z.enum(['pending', 'done', 'failed']),
  /** failed: `denied` (the person pressed Cancel at Google), `expired` (10 min passed) or `error`. */
  error: z.enum(['denied', 'expired', 'error']).nullable(),
});
export type GoogleCalendarConnectProgress = z.infer<typeof GoogleCalendarConnectProgress>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const BOOKING_TITLE_CHARACTERS = 60;

/**
 * Per AI agent: `GET`/`PUT /api/connectors/google-calendar/agents/:agentId` (admins). The server
 * enforces every rule here when the AI offers or books a time.
 */
export const BookingSettings = z
  .object({
    /** The calendar bookings go into (and whose busy times count); null = not chosen yet. */
    calendarId: z.string().min(1).max(300).nullable(),
    /** The AI may read when the calendar is busy and offer free times. */
    checkFree: z.boolean(),
    /** The AI may add an event after the customer confirms a time (needs `checkFree`). */
    book: z.boolean(),
    /** Event title; the customer's name is added ("Table booking · Mei Ying"). */
    title: z.string().trim().min(1).max(BOOKING_TITLE_CHARACTERS),
    lengthMin: z.number().int().min(15).max(240),
    /** 0 = Sunday … 6 = Saturday. */
    days: z.array(z.number().int().min(0).max(6)).max(7),
    /** Booking hours in the AI time zone (`ai_timezone`), HH:MM. */
    from: z.string().regex(TIME),
    to: z.string().regex(TIME),
    gapMin: z.number().int().min(0).max(120),
    /** Earliest booking, hours from now. */
    noticeHours: z.number().int().min(0).max(72),
    /** Latest booking, days ahead. */
    maxDays: z.number().int().min(1).max(90),
  })
  .refine((b) => b.from < b.to, { path: ['to'], message: 'to must be after from' })
  .refine((b) => b.checkFree || !b.book, {
    path: ['book'],
    message: 'book needs checkFree',
  });
export type BookingSettings = z.infer<typeof BookingSettings>;

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  calendarId: null,
  checkFree: true,
  book: false,
  title: 'Booking',
  lengthMin: 60,
  days: [1, 2, 3, 4, 5, 6],
  from: '10:00',
  to: '18:00',
  gapMin: 0,
  noticeHours: 2,
  maxDays: 14,
};

/** One line of the connector's Activity tab: who and when, never chat text. */
export const CalendarActivityKind = z.enum(['checked', 'booked', 'handed_over', 'failed']);
export type CalendarActivityKind = z.infer<typeof CalendarActivityKind>;
export const CalendarActivity = z.object({
  id: z.number().int(),
  at: z.number().int(),
  kind: CalendarActivityKind,
  agentId: z.number().int().nullable(),
  agentName: z.string(),
  chatJid: z.string().nullable(),
  /** The customer's saved or WhatsApp name (shown to admins only). */
  customer: z.string(),
  /** booked: the event's start and end (ISO). */
  start: z.string().nullable(),
  end: z.string().nullable(),
});
export type CalendarActivity = z.infer<typeof CalendarActivity>;

/** `GET /api/connectors/google-calendar/activity` (admins): newest first, at most 50. */
export const CalendarActivityList = z.object({ activity: z.array(CalendarActivity) });
export type CalendarActivityList = z.infer<typeof CalendarActivityList>;

/** One event the AI added (Bookings tab): EzyChat's own record, never read back from Google. */
export const CalendarBooking = z.object({
  id: z.number().int(),
  agentId: z.number().int(),
  agentName: z.string(),
  chatJid: z.string(),
  /** The customer's saved or WhatsApp name (shown to admins only). */
  customer: z.string(),
  start: z.string(),
  end: z.string(),
  /** When the AI booked it (ms). */
  createdAt: z.number().int(),
  /** Opens this event in Google Calendar, in the connected account. */
  eventUrl: z.string().url(),
});
export type CalendarBooking = z.infer<typeof CalendarBooking>;

/**
 * `GET /api/connectors/google-calendar/bookings` (admins): `upcoming` soonest first (at most 100),
 * `past` of the last 30 days newest first (at most 50); `calendarUrl` opens the connected account's
 * Google Calendar (null when no account is connected).
 */
export const CalendarBookingList = z.object({
  upcoming: z.array(CalendarBooking),
  past: z.array(CalendarBooking),
  calendarUrl: z.string().url().nullable(),
});
export type CalendarBookingList = z.infer<typeof CalendarBookingList>;

/** Google Calendar of `account` (`authuser` picks it when the browser has several Google accounts). */
export function googleCalendarUrl(account: string): string {
  return `https://calendar.google.com/calendar/r?authuser=${encodeURIComponent(account)}`;
}

/**
 * The calendar part of an `ai_tool_used` chat event ("AI checked free times · Google Calendar",
 * "AI booked Fri, 30 Oct, 7:30–9:00 pm · Google Calendar").
 */
export const AiToolCalendarDetail = z.object({
  action: z.enum(['checked', 'booked']),
  start: z.string().optional(),
  end: z.string().optional(),
});
export type AiToolCalendarDetail = z.infer<typeof AiToolCalendarDetail>;

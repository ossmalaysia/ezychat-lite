import type { BookingSettings } from '@ezychat/shared';

/** Most free times one `check_free_times` call returns. */
export const MAX_SLOTS = 6;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface Interval {
  start: number;
  end: number;
}

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** Wall-clock parts of `at` in `timeZone`. */
function zonedParts(at: number, timeZone: string) {
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
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Milliseconds `timeZone` is ahead of UTC at instant `at`. */
function offsetAt(at: number, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant of a wall-clock time in `timeZone` (DST-safe: the offset is checked twice). */
export function zonedTime(date: LocalDate, minutes: number, timeZone: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  let at = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(at, timeZone);
  if (second !== at) at = second;
  return at;
}

export function localDateOf(at: number, timeZone: string): LocalDate {
  const p = zonedParts(at, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** `date` plus `days` calendar days. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export const weekday = (date: LocalDate) =>
  new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

export const formatDate = (date: LocalDate) =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

export function parseDate(text: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = addDays(date, 0);
  return check.year === date.year && check.month === date.month && check.day === date.day
    ? date
    : null;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

const compare = (a: LocalDate, b: LocalDate) => formatDate(a).localeCompare(formatDate(b));

/** The window bookings may fall in: from now + notice to now + maxDays. */
export function bookingWindow(rules: BookingSettings, now: number): Interval {
  return { start: now + rules.noticeHours * HOUR, end: now + rules.maxDays * DAY };
}

/** Every start time the rules allow on one local date (busy times not considered). */
function ruleSlotsOn(date: LocalDate, rules: BookingSettings, timeZone: string): Interval[] {
  if (!rules.days.includes(weekday(date))) return [];
  const out: Interval[] = [];
  const step = rules.lengthMin + rules.gapMin;
  const close = minutesOf(rules.to);
  for (let m = minutesOf(rules.from); m + rules.lengthMin <= close; m += step) {
    const start = zonedTime(date, m, timeZone);
    out.push({ start, end: start + rules.lengthMin * MINUTE });
  }
  return out;
}

/** True when `slot` overlaps a busy time, keeping the gap between bookings free. */
export function isBusy(slot: Interval, busy: readonly Interval[], gapMin: number): boolean {
  const gap = gapMin * MINUTE;
  return busy.some((b) => b.start - gap < slot.end && b.end + gap > slot.start);
}

/**
 * Free times within the rules, in time order, at most `MAX_SLOTS`. `date` (local) limits them to one
 * day. Times before now + notice, after now + maxDays, or overlapping a busy time never appear.
 */
export function freeSlots(input: {
  rules: BookingSettings;
  timeZone: string;
  now: number;
  busy: readonly Interval[];
  date?: LocalDate | null;
}): Interval[] {
  const { rules, timeZone, now, busy } = input;
  const window = bookingWindow(rules, now);
  const first = localDateOf(window.start, timeZone);
  const last = localDateOf(window.end, timeZone);
  const out: Interval[] = [];
  for (let date = first; compare(date, last) <= 0; date = addDays(date, 1)) {
    if (input.date && compare(date, input.date) !== 0) continue;
    for (const slot of ruleSlotsOn(date, rules, timeZone)) {
      if (slot.start < window.start || slot.start > window.end) continue;
      if (isBusy(slot, busy, rules.gapMin)) continue;
      out.push(slot);
      if (out.length >= MAX_SLOTS) return out;
    }
  }
  return out;
}

/** True when the rules (days, hours, length, notice, latest day) still allow this exact time. */
export function withinRules(
  slot: Interval,
  rules: BookingSettings,
  timeZone: string,
  now: number,
): boolean {
  const window = bookingWindow(rules, now);
  if (slot.start < window.start || slot.start > window.end) return false;
  return ruleSlotsOn(localDateOf(slot.start, timeZone), rules, timeZone).some(
    (s) => s.start === slot.start && s.end === slot.end,
  );
}

/** "Friday 2026-10-30 19:30–21:00" in the business's time zone (for the model). */
export function slotLabel(slot: Interval, timeZone: string): string {
  const fmt = (at: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(at));
  const date = localDateOf(slot.start, timeZone);
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(
    new Date(slot.start),
  );
  return `${day} ${formatDate(date)} ${fmt(slot.start)}–${fmt(slot.end)}`;
}

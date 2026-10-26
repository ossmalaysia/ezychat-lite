import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOKING_SETTINGS, type BookingSettings } from '@ezychat/shared';
import {
  MAX_SLOTS,
  addDays,
  freeSlots,
  isBusy,
  parseDate,
  slotLabel,
  withinRules,
  zonedTime,
} from './slots.js';

const KL = 'Asia/Kuala_Lumpur';
const rules = (patch: Partial<BookingSettings> = {}): BookingSettings => ({
  ...DEFAULT_BOOKING_SETTINGS,
  calendarId: 'cal',
  ...patch,
});
// Monday 26 Oct 2026, 10:00 in Kuala Lumpur (UTC+8)
const MONDAY_10_KL = Date.parse('2026-10-26T02:00:00Z');
const iso = (at: number) => new Date(at).toISOString();

describe('zoned time', () => {
  it('turns a wall-clock time into the instant, also across a DST change', () => {
    expect(iso(zonedTime({ year: 2026, month: 10, day: 26 }, 12 * 60, KL))).toBe(
      '2026-10-26T04:00:00.000Z',
    );
    // London: 25 Oct 2026 is the first day of GMT; 24 Oct still BST (UTC+1)
    expect(iso(zonedTime({ year: 2026, month: 10, day: 24 }, 9 * 60, 'Europe/London'))).toBe(
      '2026-10-24T08:00:00.000Z',
    );
    expect(iso(zonedTime({ year: 2026, month: 10, day: 26 }, 9 * 60, 'Europe/London'))).toBe(
      '2026-10-26T09:00:00.000Z',
    );
  });

  it('parses only real dates and adds calendar days', () => {
    expect(parseDate('2026-10-30')).toEqual({ year: 2026, month: 10, day: 30 });
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('30/10/2026')).toBeNull();
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });
});

describe('free slots', () => {
  it('starts after the notice, inside the hours, at most six', () => {
    const slots = freeSlots({ rules: rules(), timeZone: KL, now: MONDAY_10_KL, busy: [] });
    expect(slots).toHaveLength(MAX_SLOTS);
    // notice 2 h: 12:00 is the first start; 60 min each until 18:00
    expect(slots.map((s) => slotLabel(s, KL))).toEqual([
      'Monday 2026-10-26 12:00–13:00',
      'Monday 2026-10-26 13:00–14:00',
      'Monday 2026-10-26 14:00–15:00',
      'Monday 2026-10-26 15:00–16:00',
      'Monday 2026-10-26 16:00–17:00',
      'Monday 2026-10-26 17:00–18:00',
    ]);
  });

  it('leaves out busy times and keeps the gap free on both sides', () => {
    const busy = [
      { start: Date.parse('2026-10-26T05:00:00Z'), end: Date.parse('2026-10-26T06:00:00Z') },
    ];
    const slots = freeSlots({
      rules: rules({ gapMin: 30, lengthMin: 60 }),
      timeZone: KL,
      now: MONDAY_10_KL,
      busy,
    });
    // Starts every 90 min from 10:00 (length + gap); 13:00–14:00 KL is busy, so 13:00 is out and
    // 14:30 is the first start that keeps 30 min after the busy time.
    const labels = slots.map((s) => slotLabel(s, KL));
    expect(labels[0]).toBe('Monday 2026-10-26 14:30–15:30');
    expect(
      isBusy({ start: busy[0]!.end + 29 * 60_000, end: busy[0]!.end + 89 * 60_000 }, busy, 30),
    ).toBe(true);
    expect(
      isBusy({ start: busy[0]!.end + 30 * 60_000, end: busy[0]!.end + 90 * 60_000 }, busy, 30),
    ).toBe(false);
  });

  it('skips closed days and limits one asked date', () => {
    // Sunday (0) is closed by default
    const sunday = freeSlots({
      rules: rules(),
      timeZone: KL,
      now: MONDAY_10_KL,
      busy: [],
      date: { year: 2026, month: 11, day: 1 },
    });
    expect(sunday).toEqual([]);
    const friday = freeSlots({
      rules: rules({ from: '19:30', to: '21:00', lengthMin: 90 }),
      timeZone: KL,
      now: MONDAY_10_KL,
      busy: [],
      date: { year: 2026, month: 10, day: 30 },
    });
    expect(friday.map((s) => slotLabel(s, KL))).toEqual(['Friday 2026-10-30 19:30–21:00']);
  });

  it('never goes past maxDays', () => {
    const slots = freeSlots({
      rules: rules({ maxDays: 1, from: '09:00', to: '11:00', lengthMin: 60 }),
      timeZone: KL,
      now: MONDAY_10_KL,
      busy: [],
    });
    // today's 9–11 is before the notice; tomorrow 09:00 and 10:00 are within 24 h + … only 09:00, 10:00 ≤ now+1 day
    expect(slots.map((s) => slotLabel(s, KL))).toEqual([
      'Tuesday 2026-10-27 09:00–10:00',
      'Tuesday 2026-10-27 10:00–11:00',
    ]);
    const later = freeSlots({
      rules: rules({ maxDays: 1 }),
      timeZone: KL,
      now: MONDAY_10_KL,
      busy: [],
      date: { year: 2026, month: 10, day: 29 },
    });
    expect(later).toEqual([]);
  });

  it('uses the business time zone, not the server one', () => {
    const slots = freeSlots({
      rules: rules({ from: '09:00', to: '10:00', noticeHours: 0 }),
      timeZone: 'America/New_York',
      now: MONDAY_10_KL,
      busy: [],
    });
    // Sunday 25 Oct 22:00 in New York: Monday 09:00 New York (UTC-4) = 13:00Z
    expect(iso(slots[0]!.start)).toBe('2026-10-26T13:00:00.000Z');
  });
});

describe('within rules', () => {
  it('accepts an exact rule slot and refuses moved, closed, too-soon or too-late times', () => {
    const r = rules();
    const start = Date.parse('2026-10-27T04:00:00Z'); // Tue 12:00 KL
    const hour = 3_600_000;
    expect(withinRules({ start, end: start + hour }, r, KL, MONDAY_10_KL)).toBe(true);
    expect(
      withinRules({ start: start + 60_000, end: start + hour + 60_000 }, r, KL, MONDAY_10_KL),
    ).toBe(false);
    expect(withinRules({ start, end: start + 2 * hour }, r, KL, MONDAY_10_KL)).toBe(false);
    const sunday = Date.parse('2026-11-01T04:00:00Z');
    expect(withinRules({ start: sunday, end: sunday + hour }, r, KL, MONDAY_10_KL)).toBe(false);
    const soon = Date.parse('2026-10-26T03:00:00Z'); // 11:00 today, inside the 2 h notice
    expect(withinRules({ start: soon, end: soon + hour }, r, KL, MONDAY_10_KL)).toBe(false);
    const far = start + 30 * 24 * hour;
    expect(withinRules({ start: far, end: far + hour }, r, KL, MONDAY_10_KL)).toBe(false);
  });
});

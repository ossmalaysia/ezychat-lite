import { describe, expect, it } from 'vitest';
import {
  AiToolUsedPayload,
  AiTryLookup,
  BookingSettings,
  DEFAULT_BOOKING_SETTINGS,
  GoogleCalendarStatus,
} from './index.js';

describe('connectors contract', () => {
  it('accepts the default booking settings (booking off, free times on)', () => {
    const parsed = BookingSettings.parse(DEFAULT_BOOKING_SETTINGS);
    expect(parsed).toMatchObject({ checkFree: true, book: false, calendarId: null });
  });

  it('refuses booking without the free-times check, and hours that end before they start', () => {
    const noFree = BookingSettings.safeParse({
      ...DEFAULT_BOOKING_SETTINGS,
      checkFree: false,
      book: true,
    });
    expect(noFree.success).toBe(false);
    expect(noFree.error?.issues[0]?.path).toEqual(['book']);
    const backwards = BookingSettings.safeParse({
      ...DEFAULT_BOOKING_SETTINGS,
      from: '18:00',
      to: '10:00',
    });
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0]?.path).toEqual(['to']);
    expect(BookingSettings.safeParse({ ...DEFAULT_BOOKING_SETTINGS, from: '25:00' }).success).toBe(
      false,
    );
  });

  it('keeps the calendar detail of a chat event and the not-run mark of a Try it look-up', () => {
    expect(
      AiToolUsedPayload.parse({
        title: 'Book appointment',
        sourceLabel: 'Google Calendar',
        calendar: { action: 'booked', start: '2026-10-30T11:30:00Z', end: '2026-10-30T13:00:00Z' },
      }).calendar,
    ).toEqual({ action: 'booked', start: '2026-10-30T11:30:00Z', end: '2026-10-30T13:00:00Z' });
    const lookup = {
      title: 'Book appointment',
      sourceLabel: 'Google Calendar',
      tool: 'book_appointment',
      source: 'google-calendar',
      ok: true,
      ms: 0,
    };
    expect(AiTryLookup.parse(lookup).notRun).toBeUndefined();
    expect(AiTryLookup.parse({ ...lookup, notRun: true }).notRun).toBe(true);
  });

  it('describes a not-configured connector without an account', () => {
    expect(
      GoogleCalendarStatus.parse({
        state: 'not_configured',
        account: null,
        calendars: [],
        connectedAt: null,
        problemSince: null,
      }).state,
    ).toBe('not_configured');
  });
});

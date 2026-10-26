import { describe, expect, it } from 'vitest';
import { localClock, localDate, localMidnight } from './stats.js';

describe('local day boundaries', () => {
  it('Kuala Lumpur midnight is 16:00 UTC the day before', () => {
    expect(new Date(localMidnight('2026-10-09', 'Asia/Kuala_Lumpur')).toISOString()).toBe(
      '2026-10-08T16:00:00.000Z',
    );
    expect(localDate(Date.parse('2026-10-08T16:00:00Z'), 'Asia/Kuala_Lumpur')).toBe('2026-10-09');
    expect(localDate(Date.parse('2026-10-08T15:59:59Z'), 'Asia/Kuala_Lumpur')).toBe('2026-10-08');
  });

  it('handles a daylight-saving change', () => {
    // New York springs forward on 2026-03-08: midnight is still EST (UTC-5) that day.
    expect(new Date(localMidnight('2026-03-08', 'America/New_York')).toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(new Date(localMidnight('2026-03-09', 'America/New_York')).toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });
});

describe('localClock', () => {
  it('gives the local hour and weekday (Monday = 0), also for half-hour and DST zones', () => {
    const kl = localClock('Asia/Kuala_Lumpur');
    // 2026-10-26 is a Monday; 01:30 UTC is 09:30 in Kuala Lumpur.
    expect(kl(Date.parse('2026-10-26T01:30:00Z'))).toEqual({ hour: 9, weekday: 0 });
    // 16:00 UTC Sunday is 00:00 Monday in Kuala Lumpur.
    expect(kl(Date.parse('2026-10-25T16:00:00Z'))).toEqual({ hour: 0, weekday: 0 });
    expect(kl(Date.parse('2026-10-25T15:59:59Z'))).toEqual({ hour: 23, weekday: 6 });
    const india = localClock('Asia/Kolkata'); // UTC+5:30
    expect(india(Date.parse('2026-10-26T03:29:59Z'))).toEqual({ hour: 8, weekday: 0 });
    expect(india(Date.parse('2026-10-26T03:30:00Z'))).toEqual({ hour: 9, weekday: 0 });
    const ny = localClock('America/New_York'); // springs forward 2026-03-08 07:00 UTC
    expect(ny(Date.parse('2026-03-08T06:59:00Z')).hour).toBe(1);
    expect(ny(Date.parse('2026-03-08T07:00:00Z')).hour).toBe(3);
  });

  it('returns the same answer from its cache for every instant in a quarter hour', () => {
    const kl = localClock('Asia/Kuala_Lumpur');
    const first = kl(Date.parse('2026-10-26T01:30:00Z'));
    expect(kl(Date.parse('2026-10-26T01:44:59Z'))).toBe(first);
    expect(kl(Date.parse('2026-10-26T01:45:00Z'))).not.toBe(first);
  });
});

import { describe, expect, it } from 'vitest';
import { localDate, localMidnight } from './stats.js';

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

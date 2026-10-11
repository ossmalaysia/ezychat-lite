import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateLocale } from '@/i18n';
import { formatBytes, formatDay, formatListTime, formatRelative, initials } from './format';

const now = new Date(2026, 9, 4, 12, 0);
const yesterday = new Date(2026, 9, 3, 9, 0).getTime();
const earlier = new Date(2026, 1, 5, 9, 0).getTime();
const lastYear = new Date(2025, 1, 5, 9, 0).getTime();

describe('format (locale-aware)', () => {
  afterAll(() => activateLocale('en'));

  describe('English', () => {
    beforeAll(() => activateLocale('en'));
    it('uses day-first dates and English labels', () => {
      expect(formatListTime(now.getTime(), now)).toBe('12:00');
      expect(formatListTime(yesterday, now)).toBe('Yesterday');
      expect(formatListTime(earlier, now)).toBe('5 Feb');
      expect(formatListTime(lastYear, now)).toBe('5 Feb 2025');
      expect(formatDay(now.getTime(), now)).toBe('Today');
      expect(formatDay(earlier, now)).toMatch(/Thursday,? 5 February 2026/);
      expect(formatBytes(1536)).toBe('1.5 KB');
    });
  });

  describe('Malay', () => {
    beforeAll(() => activateLocale('ms'));
    it('translates labels and month names', () => {
      expect(formatListTime(yesterday, now)).toBe('Semalam');
      expect(formatDay(now.getTime(), now)).toBe('Hari ini');
      expect(formatListTime(earlier, now)).toBe('5 Feb');
      expect(formatDay(earlier, now)).toMatch(/Khamis/);
      expect(formatRelative(Date.now() - 5 * 60_000)).toMatch(/minit/);
      expect(formatRelative(Date.now() - 2_000)).toBe('sebentar tadi');
    });
  });

  describe('Chinese', () => {
    beforeAll(() => activateLocale('zh-CN'));
    it('translates labels and uses Chinese date order', () => {
      expect(formatListTime(yesterday, now)).toBe('昨天');
      expect(formatListTime(lastYear, now)).toBe('2025年2月5日');
      expect(formatDay(earlier, now)).toMatch(/星期四/);
      expect(formatRelative(Date.now() - 5 * 60_000)).toMatch(/分钟/);
      expect(formatRelative(Date.now())).toBe('刚刚');
    });
  });
});

describe('initials', () => {
  it('uses letters only, one character for Chinese, Japanese or Korean names', () => {
    expect(initials('Nurul Aisyah binti Mohd')).toBe('NM');
    expect(initials('(kingsly) Oyen Jarvis')).toBe('KJ');
    expect(initials('~Acikwowo')).toBe('A');
    expect(initials('DATUK DAVE TEOH ❤️🌞🌟✨')).toBe('DT');
    expect(initials('陈伟明 Chen Wei Ming')).toBe('陈');
    expect(initials('ñandú éclair')).toBe('ÑÉ');
  });

  it('is empty when there are no letters, so a person icon shows instead', () => {
    expect(initials('+60 17-555 0192')).toBe('');
    expect(initials('❤️🌞')).toBe('');
    expect(initials('   ')).toBe('');
  });
});

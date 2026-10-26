import { afterAll, describe, expect, it } from 'vitest';
import { activateLocale } from '@/i18n';
import { formatTimeRange } from './format';

const at = (h: number, m: number) => new Date(2026, 9, 30, h, m).toISOString();

describe('formatTimeRange', () => {
  afterAll(() => activateLocale('en'));

  it('shows the day and both times in the browser time zone', async () => {
    await activateLocale('en');
    expect(formatTimeRange(at(19, 30), at(21, 0))).toMatch(/^Fri,? 30 Oct, 19:30–21:00$/);
  });

  it('follows the UI language', async () => {
    await activateLocale('zh-CN');
    const text = formatTimeRange(at(19, 30), at(21, 0));
    expect(text).toContain('10月30日');
    expect(text).toContain('–');
  });

  it('is empty for an invalid date', () => {
    expect(formatTimeRange('nope', at(21, 0))).toBe('');
    expect(formatTimeRange(at(19, 30), '')).toBe('');
  });
});

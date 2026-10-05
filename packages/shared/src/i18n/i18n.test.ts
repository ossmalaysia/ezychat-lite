import { describe, expect, it } from 'vitest';
import {
  catalogProblems,
  createTranslator,
  isLocale,
  LocaleSchema,
  resolveLocale,
} from './index.js';

describe('resolveLocale', () => {
  it('matches exact and regional tags', () => {
    expect(resolveLocale(['ms-MY'])).toBe('ms');
    expect(resolveLocale(['zh-CN'])).toBe('zh-CN');
    expect(resolveLocale(['zh'])).toBe('zh-CN');
    expect(resolveLocale(['zh-SG'])).toBe('zh-CN');
    expect(resolveLocale(['zh-Hans-MY'])).toBe('zh-CN');
    expect(resolveLocale(['en-GB'])).toBe('en');
    expect(resolveLocale(['zh_CN'])).toBe('zh-CN');
  });

  it('skips unsupported tags and traditional Chinese, defaulting to English', () => {
    expect(resolveLocale(['th-TH', 'ms'])).toBe('ms');
    expect(resolveLocale(['zh-TW', 'zh-Hant-HK'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
    expect(resolveLocale([null, undefined, ''])).toBe('en');
  });

  it('validates locale codes', () => {
    expect(isLocale('ms')).toBe(true);
    expect(isLocale('zh')).toBe(false);
    expect(LocaleSchema.safeParse('zh-CN').success).toBe(true);
    expect(LocaleSchema.safeParse('fr').success).toBe(false);
  });
});

describe('createTranslator', () => {
  const en = { a: { b: 'Hello {{name}}' }, only: 'English only' };
  const t = createTranslator(en, { en, ms: { a: { b: 'Helo {{name}}' } } });

  it('interpolates and falls back to English', () => {
    expect(t('ms', 'a.b', { name: 'Ali' })).toBe('Helo Ali');
    expect(t('ms', 'only')).toBe('English only');
    expect(t(null, 'a.b', { name: 'Ann' })).toBe('Hello Ann');
    expect(t('zh-CN', 'a.b')).toBe('Hello {{name}}');
  });
});

describe('catalogProblems', () => {
  it('reports missing, extra, empty and placeholder mismatches', () => {
    const problems = catalogProblems(
      { a: 'A {{x}}', b: 'B', n_one: '{{count}} item', n_other: '{{count}} items' },
      { a: 'A {{y}}', c: 'C', n_other: '{{count}} barang', b: ' ' },
    );
    expect(problems).toEqual(
      expect.arrayContaining(['extra: c', 'empty: b', 'placeholders differ: a (y vs x)']),
    );
    expect(problems.some((p) => p.includes('n_'))).toBe(false);
  });
});

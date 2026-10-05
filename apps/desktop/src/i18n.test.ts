import { describe, expect, it } from 'vitest';
import {
  catalogProblems,
  createTranslator,
  LOCALE_CODES,
  resolveLocale,
  SUPPORTED_LOCALES,
} from '@wa-team-inbox/shared';
import {
  DESKTOP_LOCALES,
  desktopCatalogs,
  desktopIntlTag,
  desktopLocale,
  resolveDesktopLocale,
  statusStrings,
  t,
} from './i18n.js';

describe('desktop catalogs', () => {
  it.each(LOCALE_CODES)('%s matches the English keys and placeholders', (locale) => {
    expect(catalogProblems(desktopCatalogs.en, desktopCatalogs[locale])).toEqual([]);
  });

  it('translates with placeholders and falls back to English', () => {
    expect(t('ms', 'tray.status')).toBe('Status & Perkhidmatan…');
    expect(t('zh-CN', 'tray.quit')).toBe('退出');
    expect(t(null, 'mode.standalone', { state: 'running' })).toBe('Standalone — running');
    expect(t('ms', 'page.notStartedBody', { port: 7420 })).toContain('Port 7420');
  });

  it('behaves like the shared translator', () => {
    const shared = createTranslator(desktopCatalogs.en, desktopCatalogs);
    for (const locale of [...LOCALE_CODES, null]) {
      expect(t(locale, 'updates.trayRestart', { version: '1.2.3' })).toBe(
        shared(locale, 'updates.trayRestart', { version: '1.2.3' }),
      );
    }
  });

  it('flattens the status window strings', () => {
    const ms = statusStrings('ms');
    expect(ms['openInbox']).toBe('Buka peti masuk');
    expect(ms['updates.downloading']).toContain('{{percent}}');
    expect(Object.keys(ms).sort()).toEqual(Object.keys(statusStrings('en')).sort());
  });
});

describe('desktop locale', () => {
  it('mirrors the shared locale list', () => {
    expect(DESKTOP_LOCALES.map((l) => [l.code, l.intlTag])).toEqual(
      SUPPORTED_LOCALES.map((l) => [l.code, l.intlTag]),
    );
    expect(desktopIntlTag('ms')).toBe('ms-MY');
  });

  it.each([
    [['ms-MY'], 'ms'],
    [['en-US'], 'en'],
    [['zh-Hans-MY'], 'zh-CN'],
    [['zh-SG'], 'zh-CN'],
    [['zh_CN'], 'zh-CN'],
    [['zh-TW', 'ms'], 'ms'],
    [['zh-Hant-HK'], 'en'],
    [['fr-FR', 'ms-MY'], 'ms'],
    [['ja-JP'], 'en'],
    [[], 'en'],
    [[null, undefined, ''], 'en'],
  ] as const)('%j → %s (same as shared resolveLocale)', (tags, expected) => {
    expect(resolveDesktopLocale(tags)).toBe(expected);
    expect(resolveLocale(tags)).toBe(expected);
  });

  it('uses the OS languages, then the app locale', () => {
    expect(
      desktopLocale({
        getPreferredSystemLanguages: () => ['zh-Hans-SG'],
        getLocale: () => 'en-US',
      }),
    ).toBe('zh-CN');
    expect(desktopLocale({ getPreferredSystemLanguages: () => [], getLocale: () => 'ms' })).toBe(
      'ms',
    );
    expect(
      desktopLocale({
        getPreferredSystemLanguages: () => {
          throw new Error('unsupported');
        },
        getLocale: () => 'en-GB',
      }),
    ).toBe('en');
  });
});

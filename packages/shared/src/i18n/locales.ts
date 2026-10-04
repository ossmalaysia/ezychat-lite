import { z } from 'zod';

/**
 * Supported UI languages. Adding a language: append an entry here, add its catalogs
 * (`messages.ts` here, `apps/web/src/i18n/locales/<code>/`), and map its date-fns locale in
 * `apps/web/src/i18n/date-locale.ts`. See docs/i18n.md.
 */
export const SUPPORTED_LOCALES = [
  // `intlTag` drives Intl date/number formatting (en-GB: day-first dates, as used in the region).
  { code: 'en', nativeName: 'English', englishName: 'English', intlTag: 'en-GB' },
  { code: 'ms', nativeName: 'Bahasa Melayu', englishName: 'Malay', intlTag: 'ms-MY' },
  { code: 'zh-CN', nativeName: '简体中文', englishName: 'Chinese (Simplified)', intlTag: 'zh-CN' },
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number]['code'];

export const LOCALE_CODES = SUPPORTED_LOCALES.map((l) => l.code) as [Locale, ...Locale[]];
export const LocaleSchema = z.enum(LOCALE_CODES);
export const DEFAULT_LOCALE: Locale = 'en';

export function intlTag(locale: Locale): string {
  return SUPPORTED_LOCALES.find((l) => l.code === locale)?.intlTag ?? 'en-GB';
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALE_CODES as readonly string[]).includes(value);
}

/**
 * Language-only fallbacks for tags that are not listed exactly, e.g. `zh-SG`, `zh-Hans-MY` → `zh-CN`.
 * Traditional-script tags are excluded so they don't silently get Simplified text.
 */
const LANGUAGE_FALLBACK: Record<string, Locale> = { en: 'en', ms: 'ms', zh: 'zh-CN' };
const TRADITIONAL_CHINESE = /^zh-(hant|tw|hk|mo)\b/i;

/** First supported match for a list of BCP-47 tags (e.g. `navigator.languages`), else English. */
export function resolveLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const raw of tags) {
    if (!raw) continue;
    const tag = raw.trim().replace(/_/g, '-');
    const exact = LOCALE_CODES.find((c) => c.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    if (TRADITIONAL_CHINESE.test(tag)) continue;
    const fallback = LANGUAGE_FALLBACK[tag.split('-')[0]!.toLowerCase()];
    if (fallback) return fallback;
  }
  return DEFAULT_LOCALE;
}

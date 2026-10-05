// Desktop shell strings (tray, dialogs, message pages, status window). The desktop shell is per
// machine, so it follows the OS language rather than a web user's language setting. Log messages
// stay English.
//
// Only *types* come from @wa-team-inbox/shared: the main process is compiled by tsc and run by
// Electron as plain JS, and the shared package ships TypeScript source (plus zod), which cannot be
// loaded at runtime from dist/ or the packaged app. The tiny runtime pieces below mirror
// packages/shared/src/i18n; i18n.test.ts checks that they behave exactly like the shared ones.
// No electron import here, so the catalogs stay unit-testable.
import type { Catalog, CatalogKey, Locale, Translator } from '@wa-team-inbox/shared';
// Catalogs live in ./locales/*.json (tsc copies them to dist/ next to this file).
import en from './locales/en.json' with { type: 'json' };
import msCatalog from './locales/ms.json' with { type: 'json' };
import zhCNCatalog from './locales/zh-CN.json' with { type: 'json' };

export type DesktopCatalog = typeof en;
export type DesktopKey = CatalogKey<DesktopCatalog>;

const ms: DesktopCatalog = msCatalog;
const zhCN: DesktopCatalog = zhCNCatalog;

export const desktopCatalogs: Record<Locale, Catalog> = { en, ms, 'zh-CN': zhCN };

/** Mirrors SUPPORTED_LOCALES (code + Intl tag) from @wa-team-inbox/shared; checked by i18n.test.ts. */
export const DESKTOP_LOCALES = [
  { code: 'en', intlTag: 'en-GB' },
  { code: 'ms', intlTag: 'ms-MY' },
  { code: 'zh-CN', intlTag: 'zh-CN' },
] as const satisfies readonly { code: Locale; intlTag: string }[];

const DEFAULT_LOCALE: Locale = 'en';
const LANGUAGE_FALLBACK: Record<string, Locale> = { en: 'en', ms: 'ms', zh: 'zh-CN' };
const TRADITIONAL_CHINESE = /^zh-(hant|tw|hk|mo)\b/i;

/** Same rules as shared `resolveLocale`: first supported tag, language fallback, else English. */
export function resolveDesktopLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const raw of tags) {
    if (!raw) continue;
    const tag = raw.trim().replace(/_/g, '-');
    const exact = DESKTOP_LOCALES.find((l) => l.code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    if (TRADITIONAL_CHINESE.test(tag)) continue;
    const fallback = LANGUAGE_FALLBACK[tag.split('-')[0]!.toLowerCase()];
    if (fallback) return fallback;
  }
  return DEFAULT_LOCALE;
}

export function desktopIntlTag(locale: Locale): string {
  return DESKTOP_LOCALES.find((l) => l.code === locale)?.intlTag ?? 'en-GB';
}

/** The OS language of this machine (call after `app.whenReady()`). Pass Electron's `app`. */
export function desktopLocale(app: {
  getPreferredSystemLanguages(): string[];
  getLocale(): string;
}): Locale {
  let tags: string[] = [];
  try {
    tags = app.getPreferredSystemLanguages();
  } catch {
    // older platforms: fall back to the Chromium UI locale below
  }
  return resolveDesktopLocale([...tags, app.getLocale()]);
}

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) {
    if (node == null || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** Same behaviour as shared `createTranslator(en, desktopCatalogs)`: falls back to English, then the key. */
export const t: Translator<DesktopCatalog> = (locale, key, vars) =>
  interpolate(
    lookup(desktopCatalogs[locale ?? DEFAULT_LOCALE], key) ?? lookup(en, key) ?? key,
    vars,
  );

/** The status window's strings, flattened (`updates.installed` → text) for the status payload. */
export function statusStrings(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: Catalog, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out[path] = t(locale, `status.${path}` as DesktopKey);
      else walk(v, path);
    }
  };
  walk(en.status, '');
  return out;
}

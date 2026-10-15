import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, type Locale } from '@ezychat/shared';
import { loadDateLocale } from './date-locale';
import { enResources, NAMESPACES, type Namespace } from './resources';

// Non-English catalogs are split into their own chunks and fetched when first selected.
const lazyCatalogs = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*/*.json',
  '!./locales/en/*.json',
]);

const loaded = new Set<Locale>([DEFAULT_LOCALE]);

async function loadCatalogs(locale: Locale): Promise<void> {
  if (loaded.has(locale)) return;
  await Promise.all(
    NAMESPACES.map(async (ns: Namespace) => {
      const load = lazyCatalogs[`./locales/${locale}/${ns}.json`];
      if (!load) return; // missing namespace → English fallback
      const mod = await load();
      i18n.addResourceBundle(locale, ns, mod.default, true, true);
    }),
  );
  loaded.add(locale);
}

/** Product name used by catalog strings through `{{product}}`; another edition replaces it. */
export const DEFAULT_PRODUCT_NAME = 'EzyChat Lite';
const defaultVariables: { product: string } = { product: DEFAULT_PRODUCT_NAME };

/**
 * Sets the product name every `{{product}}` in the catalogs shows (e.g. "EzyChat Enterprise").
 * i18next reads default variables on each translation, so this also applies after init.
 */
export function setProductName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new Error('productName must be 1–60 characters');
  defaultVariables.product = trimmed;
}

let initialized: Promise<unknown> | null = null;

/** Initializes i18next once with the English catalogs bundled. */
export function initI18n(): Promise<unknown> {
  initialized ??= i18n.use(initReactI18next).init({
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: false,
    load: 'currentOnly',
    ns: [...NAMESPACES],
    defaultNS: 'common',
    resources: { en: enResources },
    interpolation: { escapeValue: false, defaultVariables }, // React already escapes
    returnNull: false,
    react: { useSuspense: false },
  });
  return initialized;
}

let switchSeq = 0;

/**
 * Loads a language's catalogs and date-fns locale, then switches to it. When calls overlap, only
 * the most recent one is applied.
 */
export async function activateLocale(locale: Locale): Promise<void> {
  const seq = ++switchSeq;
  await initI18n();
  await loadCatalogs(locale);
  if (seq !== switchSeq) return;
  await loadDateLocale(locale);
  if (seq !== switchSeq) return;
  await i18n.changeLanguage(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export { i18n };

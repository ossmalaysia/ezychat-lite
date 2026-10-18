import { useTranslation } from 'react-i18next';
import { i18n, initI18n } from '@/i18n';
import type { WebExtension } from './types';

/**
 * Adds extension catalogs to the `common` namespace (the default one), on top of the core
 * catalogs. Keys are `ext.<name>.…`, so they never overwrite a core key; a key missing in one
 * language falls back to English the same way core keys do. Call after `validateWebExtensions`.
 */
export async function registerExtensionCatalogs(
  extensions: readonly WebExtension[],
): Promise<void> {
  await initI18n();
  for (const ext of extensions) {
    for (const [locale, catalog] of Object.entries(ext.catalogs ?? {})) {
      if (catalog) i18n.addResources(locale, 'common', catalog);
    }
  }
}

/** Translates a key that is not in the typed core catalogs. */
export type ExtensionTranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * `t` for extension keys (`ext.<name>.…`, `common` namespace). Core keys are type-checked against
 * the bundled catalogs, which extension keys are not part of; this hook takes any string and
 * re-renders on a language change like `useTranslation`.
 */
export function useExtensionTranslation(): ExtensionTranslate {
  const { t } = useTranslation('common');
  return t as unknown as ExtensionTranslate;
}

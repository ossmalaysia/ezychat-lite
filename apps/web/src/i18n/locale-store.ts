import { useSyncExternalStore } from 'react';
import { isLocale, resolveLocale, type Locale } from '@wa-team-inbox/shared';
import { activateLocale } from './index';

export const LOCALE_STORAGE_KEY = 'wati.locale';

function browserLocale(target?: Window): Locale {
  const nav = target?.navigator;
  return resolveLocale(nav ? [...(nav.languages ?? []), nav.language] : []);
}

/**
 * The active UI language. Order: the signed-in user's saved choice (applied by `LocaleSync`),
 * then this browser's last choice (`wati.locale`), then the browser languages, then English.
 * Changes are shared with other tabs through the storage event.
 */
export function createLocaleStore(target?: Window) {
  const listeners = new Set<() => void>();
  let storage: Storage | undefined;
  let saved: string | null = null;
  try {
    storage = target?.localStorage;
    saved = storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    // Storage may be blocked; the choice still applies for this session.
  }
  let locale: Locale = isLocale(saved) ? saved : browserLocale(target);

  function apply(next: Locale): Promise<void> {
    const done = activateLocale(next);
    if (locale !== next) {
      locale = next;
      listeners.forEach((l) => l());
    }
    return done;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== storage) return;
    if (event.key !== LOCALE_STORAGE_KEY && event.key !== null) return;
    void apply(isLocale(event.newValue) ? event.newValue : browserLocale(target));
  };
  target?.addEventListener('storage', onStorage);

  return {
    getSnapshot: () => locale,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Applies the initial language; resolves once its catalogs are ready. */
    ready: () => apply(locale),
    setLocale(next: Locale): Promise<void> {
      try {
        storage?.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // Continue applying the choice when persistence is unavailable.
      }
      return apply(next);
    },
    dispose() {
      target?.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
}

export const localeStore = createLocaleStore(typeof window === 'undefined' ? undefined : window);

export function useLocale(): Locale {
  return useSyncExternalStore(
    localeStore.subscribe,
    localeStore.getSnapshot,
    localeStore.getSnapshot,
  );
}

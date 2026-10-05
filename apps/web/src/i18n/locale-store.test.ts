import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocaleStore, LOCALE_STORAGE_KEY } from './locale-store';

const activateLocale = vi.fn<(locale: string) => Promise<void>>();
vi.mock('./index', () => ({ activateLocale: (l: string) => activateLocale(l) }));

function fakeWindow(saved: string | null = null) {
  const data = new Map<string, string>(saved ? [[LOCALE_STORAGE_KEY, saved]] : []);
  return {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    },
    navigator: { languages: ['en-GB'], language: 'en-GB' },
    addEventListener: () => {},
    removeEventListener: () => {},
    data,
  };
}

describe('locale store', () => {
  beforeEach(() => {
    activateLocale.mockReset();
  });

  it('switches and remembers the language once its catalogs load', async () => {
    activateLocale.mockResolvedValue(undefined);
    const w = fakeWindow();
    const store = createLocaleStore(w as unknown as Window);
    const listener = vi.fn();
    store.subscribe(listener);
    await store.setLocale('ms');
    expect(store.getSnapshot()).toBe('ms');
    expect(w.data.get(LOCALE_STORAGE_KEY)).toBe('ms');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the current language and storage when loading fails', async () => {
    activateLocale.mockRejectedValue(new Error('chunk 404'));
    const w = fakeWindow();
    const store = createLocaleStore(w as unknown as Window);
    await expect(store.setLocale('zh-CN')).rejects.toThrow('chunk 404');
    expect(store.getSnapshot()).toBe('en');
    expect(w.data.has(LOCALE_STORAGE_KEY)).toBe(false);
    // choosing it again is retried, not treated as already active
    activateLocale.mockResolvedValue(undefined);
    await store.setLocale('zh-CN');
    expect(store.getSnapshot()).toBe('zh-CN');
  });

  it('applies only the latest of overlapping switches', async () => {
    let finishMs!: () => void;
    activateLocale.mockImplementation((l) =>
      l === 'ms' ? new Promise<void>((r) => (finishMs = r)) : Promise.resolve(),
    );
    const w = fakeWindow();
    const store = createLocaleStore(w as unknown as Window);
    const slow = store.setLocale('ms');
    await store.setLocale('zh-CN');
    finishMs();
    await slow;
    expect(store.getSnapshot()).toBe('zh-CN');
    expect(w.data.get(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  });

  it('falls back to English when the saved language cannot load at startup', async () => {
    activateLocale.mockRejectedValue(new Error('offline'));
    const store = createLocaleStore(fakeWindow('ms') as unknown as Window);
    expect(store.getSnapshot()).toBe('ms');
    await expect(store.ready()).rejects.toThrow('offline');
    expect(store.getSnapshot()).toBe('en');
  });
});

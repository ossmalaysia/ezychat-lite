import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../admin/SettingsPage';
import { createThemeStore, THEME_STORAGE_KEY, useTheme } from './theme';

const patch = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null }));
vi.mock('../api/queries', () => ({
  useSettings: () => ({
    isPending: false,
    isError: false,
    data: { port: 7420, lanEnabled: false, historyDays: 3 },
  }),
  usePatchSettings: () => patch,
}));
vi.mock('../pwa/PushToggle', () => ({ PushToggle: () => <span>Notification controls</span> }));
vi.mock('../admin/ResolveAllChatsCard', () => ({ ResolveAllChatsCard: () => null }));

const stores: ReturnType<typeof createThemeStore>[] = [];
function device(dark = false) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: vi.fn((_event: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_event: string, fn: () => void) => listeners.delete(fn)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  const store = createThemeStore(window);
  stores.push(store);
  return {
    store,
    media,
    changeSystem(darkMode: boolean) {
      media.matches = darkMode;
      listeners.forEach((listener) => listener());
    },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  patch.mutate.mockClear();
});
afterEach(() => {
  cleanup();
  stores.splice(0).forEach((store) => store.dispose());
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('device appearance', () => {
  it('defaults to System and follows operating-system changes', () => {
    const { store, changeSystem } = device(true);
    expect(store.getSnapshot()).toEqual({ theme: 'system', resolvedTheme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    changeSystem(false);
    expect(store.getSnapshot()).toEqual({ theme: 'system', resolvedTheme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    changeSystem(true);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('loads a saved choice and lets Light override a dark operating system', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { store, changeSystem } = device(true);
    expect(store.getSnapshot()).toEqual({ theme: 'light', resolvedTheme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
    changeSystem(false);
    changeSystem(true);
    expect(store.getSnapshot().resolvedTheme).toBe('light');
    store.setTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    store.setTheme('system');
    expect(store.getSnapshot()).toEqual({ theme: 'system', resolvedTheme: 'dark' });
  });

  it('ignores invalid saved values and synchronizes changes or clearing from another tab', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'invalid');
    const { store } = device(false);
    expect(store.getSnapshot().theme).toBe('system');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    expect(store.getSnapshot()).toEqual({ theme: 'dark', resolvedTheme: 'dark' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'light' }));
    expect(store.getSnapshot().theme).toBe('dark');
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    expect(store.getSnapshot()).toEqual({ theme: 'system', resolvedTheme: 'light' });
  });

  it('keeps working when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    const { store } = device();
    expect(store.getSnapshot().theme).toBe('system');
    expect(() => store.setTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('updates all hook subscribers immediately', () => {
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());
    act(() => first.result.current.setTheme('dark'));
    expect(first.result.current.theme).toBe('dark');
    expect(second.result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => first.result.current.setTheme('system'));
  });

  it('exposes Light, Dark, and System in device settings without saving server settings', () => {
    render(<SettingsPage />);
    const group = screen.getByRole('radiogroup', { name: 'Appearance' });
    expect(group).toBeDefined();
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(patch.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
  });
});

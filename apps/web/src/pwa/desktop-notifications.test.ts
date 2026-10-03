import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  desktopNotificationsEnabled,
  setDesktopNotifications,
  showDesktopNotification,
} from './desktop-notifications';
import { subscribePush, unsubscribePush } from './push';

vi.mock('@/lib/error-reporter', () => ({ reportClientError: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  window.watiNotifications = {
    isSupported: vi.fn().mockResolvedValue(true),
    show: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => {
  delete window.watiNotifications;
  vi.restoreAllMocks();
});

describe('desktop notification registration', () => {
  it('opts in without contacting a browser push service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await subscribePush()).toBeNull();
    expect(window.watiNotifications!.isSupported).toHaveBeenCalled();
    expect(desktopNotificationsEnabled()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('does not display previews before opt-in, and clears on opt-out', async () => {
    const payload = { title: 'Customer', body: 'Hello', url: '/chats/customer', tag: 'customer' };
    await showDesktopNotification(payload);
    expect(window.watiNotifications!.show).not.toHaveBeenCalled();
    await subscribePush();
    await showDesktopNotification(payload);
    expect(window.watiNotifications!.show).toHaveBeenCalledWith(payload);
    await unsubscribePush();
    expect(desktopNotificationsEnabled()).toBe(false);
    expect(window.watiNotifications!.clear).toHaveBeenCalled();
    await showDesktopNotification(payload);
    expect(window.watiNotifications!.show).toHaveBeenCalledTimes(1);
  });
  it('keeps registration off when native notifications are unavailable', async () => {
    vi.mocked(window.watiNotifications!.isSupported).mockResolvedValue(false);
    await expect(setDesktopNotifications(true)).rejects.toThrow(
      'Desktop notifications are unavailable',
    );
    expect(desktopNotificationsEnabled()).toBe(false);
  });
  it('rejects malformed socket notification payloads', async () => {
    await subscribePush();
    await showDesktopNotification({
      title: 'x'.repeat(201),
      body: 'Hello',
      url: '/chats/customer',
      tag: 'customer',
    });
    expect(window.watiNotifications!.show).not.toHaveBeenCalled();
  });
});

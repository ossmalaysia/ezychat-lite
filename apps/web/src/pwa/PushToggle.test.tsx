import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PushToggle } from './PushToggle';

beforeEach(() => {
  localStorage.clear();
  window.watiNotifications = {
    isSupported: vi.fn().mockResolvedValue(true),
    show: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => {
  cleanup();
  delete window.watiNotifications;
});

it('turns desktop notifications on and off without browser push registration', async () => {
  render(<PushToggle />);
  const toggle = screen.getByRole('switch', { name: 'Notifications on this device' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect(screen.queryByText(/registration failed/i)).toBeNull();
  expect(screen.getByText(/Keep it running in the tray/)).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  expect(window.watiNotifications!.clear).toHaveBeenCalled();
});

it('shows a useful native availability error and keeps the switch off', async () => {
  vi.mocked(window.watiNotifications!.isSupported).mockResolvedValue(false);
  render(<PushToggle />);
  const toggle = screen.getByRole('switch', { name: 'Notifications on this device' });
  fireEvent.click(toggle);
  await screen.findByText(/Desktop notifications are unavailable/);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});

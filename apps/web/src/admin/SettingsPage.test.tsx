import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const settings = { port: 7420, lanEnabled: false, historyDays: 3 };
const patch = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null }));
vi.mock('../api/queries', () => ({
  useSettings: () => ({ isPending: false, isError: false, data: settings }),
  usePatchSettings: () => patch,
}));
vi.mock('../pwa/PushToggle', () => ({ PushToggle: () => null }));
vi.mock('@/lib/theme', () => ({
  THEME_OPTIONS: [],
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

beforeEach(() => {
  patch.mutate.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('toggles LAN once from the padded target or switch and saves only when requested', async () => {
  render(<SettingsPage />);
  const user = userEvent.setup();
  const control = screen.getByRole('switch', {
    name: 'Allow access from the local network (LAN)',
  });
  const paddedTarget = control.closest('label');
  expect(paddedTarget).not.toBeNull();
  const save = screen.getByRole('button', { name: 'Save settings' });
  expect(save.hasAttribute('disabled')).toBe(true);

  await user.click(paddedTarget!);
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(save.hasAttribute('disabled')).toBe(false);
  expect(patch.mutate).not.toHaveBeenCalled();

  await user.click(control);
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(save.hasAttribute('disabled')).toBe(true);

  await user.click(paddedTarget!);
  await user.click(save);
  expect(patch.mutate).toHaveBeenCalledTimes(1);
  expect(patch.mutate).toHaveBeenCalledWith({ lanEnabled: true }, expect.any(Object));
});

it('keeps the switch keyboard accessible without submitting network settings', async () => {
  render(<SettingsPage />);
  const user = userEvent.setup();
  const control = screen.getByRole('switch', {
    name: 'Allow access from the local network (LAN)',
  });
  await user.click(screen.getByRole('spinbutton', { name: 'Port' }));
  await user.tab();
  expect(document.activeElement).toBe(control);
  await user.keyboard(' ');
  expect(control.getAttribute('aria-checked')).toBe('true');
  await user.keyboard('{Enter}');
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(patch.mutate).not.toHaveBeenCalled();
});

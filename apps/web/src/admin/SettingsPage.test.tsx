import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

let settings = { port: 7420, lanEnabled: false, historyDays: 3 };
const patch = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null }));
vi.mock('../api/queries', () => ({
  useSettings: () => ({ isPending: false, isError: false, data: settings }),
  usePatchSettings: () => patch,
}));
vi.mock('../pwa/PushToggle', () => ({ PushToggle: () => null }));
vi.mock('./ResolveAllChatsCard', () => ({ ResolveAllChatsCard: () => null }));
vi.mock('@/lib/theme', () => ({
  THEME_OPTIONS: [],
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

beforeEach(() => {
  settings = { port: 7420, lanEnabled: false, historyDays: 3 };
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

it('preserves edited fields through a background refresh while updating untouched defaults', async () => {
  const view = render(<SettingsPage />);
  const user = userEvent.setup();
  const port = screen.getByRole('spinbutton', { name: 'Port' }) as HTMLInputElement;
  await user.clear(port);
  await user.type(port, '7550');
  await user.click(screen.getByRole('switch'));
  settings = { port: 7440, lanEnabled: false, historyDays: 10 };
  view.rerender(<SettingsPage />);
  expect(port.value).toBe('7550');
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  expect(
    (
      screen.getByRole('spinbutton', {
        name: 'Days of history to import when linking',
      }) as HTMLInputElement
    ).value,
  ).toBe('10');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(patch.mutate).toHaveBeenCalledWith({ port: 7550, lanEnabled: true }, expect.any(Object));
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

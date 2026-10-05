import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';

let settings = { port: 7420, lanEnabled: false, historyDays: 3 };
const patch = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null }));
vi.mock('../api/queries', () => ({
  useSettings: () => ({ isPending: false, isError: false, data: settings }),
  usePatchSettings: () => patch,
}));
vi.mock('../pwa/PushToggle', () => ({ PushToggle: () => null }));
vi.mock('./ResolveAllChatsCard', () => ({ ResolveAllChatsCard: () => <p>Resolve all card</p> }));
vi.mock('./AiMemberPanel', () => ({
  AiMemberPanel: ({ section }: { section: string }) => <p>Configure inbox AI: {section}</p>,
}));
const setTheme = vi.hoisted(() => vi.fn());
const changeLocale = vi.hoisted(() => vi.fn());
vi.mock('@/lib/theme', () => ({
  THEME_OPTIONS: [
    { value: 'light', labelKey: 'theme.light' },
    { value: 'dark', labelKey: 'theme.dark' },
    { value: 'system', labelKey: 'theme.system' },
  ],
  useTheme: () => ({ theme: 'system', setTheme }),
}));
vi.mock('@/i18n/use-change-locale', () => ({
  useChangeLocale: () => ({ locale: 'en', changeLocale }),
}));

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/settings/*" element={<SettingsPage />} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
}

function renderAt(path = '/admin/settings/general') {
  return render(tree(path));
}

beforeEach(() => {
  settings = { port: 7420, lanEnabled: false, historyDays: 3 };
  patch.mutate.mockClear();
  setTheme.mockClear();
  changeLocale.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

it('opens shared AI connection configuration from Settings', async () => {
  renderAt('/admin/settings/ai');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Configure AI connection' }));
  expect(screen.getByText('Configure inbox AI: connection')).toBeTruthy();
  expect(patch.mutate).not.toHaveBeenCalled();
});

it('preserves edited fields through a background refresh while updating untouched defaults', async () => {
  const view = renderAt();
  const user = userEvent.setup();
  const port = screen.getByRole('spinbutton', { name: 'Port' }) as HTMLInputElement;
  await user.clear(port);
  await user.type(port, '7550');
  await user.click(screen.getByRole('switch'));
  settings = { port: 7440, lanEnabled: false, historyDays: 10 };
  view.rerender(tree('/admin/settings/general'));
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
  renderAt();
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
  renderAt();
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

it.each([
  ['general', 'Port', ['Configure AI connection', 'Resolve all card', 'Appearance']],
  ['ai', 'Configure AI connection', ['Port', 'Resolve all card', 'Appearance']],
  ['device', 'Appearance', ['Port', 'Configure AI connection', 'Resolve all card']],
  ['maintenance', 'Resolve all card', ['Port', 'Configure AI connection', 'Appearance']],
])('renders only the %s section on its route', (tab, shown, hidden) => {
  renderAt(`/admin/settings/${tab}`);
  expect(screen.getAllByText(shown).length).toBeGreaterThan(0);
  for (const h of hidden) expect(screen.queryByText(h)).toBeNull();
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe(
    { general: 'General', ai: 'AI', device: 'This device', maintenance: 'Maintenance' }[tab],
  );
});

it.each(['/admin/settings', '/admin/settings/', '/admin/settings/nope', '/admin/settings/ai/x'])(
  'redirects %s to the General tab',
  async (path) => {
    renderAt(path);
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/settings/general'),
    );
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toBeTruthy();
  },
);

it('navigates between tabs with absolute admin paths', async () => {
  renderAt();
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'Maintenance' }));
  expect(screen.getByTestId('location').textContent).toBe('/admin/settings/maintenance');
});

it('shows the restart banner only on the General tab', async () => {
  patch.mutate.mockImplementationOnce((_b, o) => o.onSuccess({ restartRequired: true }));
  renderAt();
  const user = userEvent.setup();
  await user.click(screen.getByRole('switch'));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(screen.getByText('Restart required')).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'AI' }));
  expect(screen.queryByText('Restart required')).toBeNull();
});

it('marks maintenance as a danger zone', () => {
  renderAt('/admin/settings/maintenance');
  expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeTruthy();
});

it('changes theme and language from compact segmented controls', async () => {
  renderAt('/admin/settings/device');
  const user = userEvent.setup();
  expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeTruthy();
  await user.click(screen.getByText('Dark'));
  expect(setTheme).toHaveBeenCalledWith('dark');
  expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe('true');
  await user.click(screen.getByText('中文'));
  expect(changeLocale).toHaveBeenCalledWith('zh-CN');
  expect(screen.getByText('Follows you on every device')).toBeTruthy();
});

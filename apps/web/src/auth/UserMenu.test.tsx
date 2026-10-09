import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { activateLocale } from '@/i18n';
import { UserMenu } from './UserMenu';

const changeLocale = vi.fn();
vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'ali', displayName: 'Ali Bin Abu', role: 'agent', locale: null },
    isAdmin: false,
    logout: vi.fn(),
  }),
}));
vi.mock('@/i18n/use-change-locale', () => ({
  useChangeLocale: () => ({ locale: 'en', changeLocale }),
}));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.0' }));
vi.mock('@/pwa/PushToggle', () => ({ PushToggle: () => null }));

afterEach(async () => {
  cleanup();
  await activateLocale('en');
});

it('lists every supported language by its native name and changes language', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Account menu' }));
  const group = screen.getByRole('group', { name: 'Language' });
  for (const name of ['English', 'Bahasa Melayu', '简体中文'])
    expect(group.textContent).toContain(name);
  await user.click(screen.getByRole('menuitemradio', { name: 'Bahasa Melayu' }));
  expect(changeLocale).toHaveBeenCalledWith('ms');
});

it('renders menu labels in the active language', async () => {
  await activateLocale('zh-CN');
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: '账户菜单' }));
  expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeTruthy();
  expect(screen.getByText(/客服/)).toBeTruthy();
  // Loading a locale lazily can exceed 5 s when the whole suite runs in parallel.
}, 20_000);

it('puts theme on one compact switch with Light, Dark and System', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Account menu' }));
  const theme = screen.getByRole('group', { name: 'Appearance' });
  for (const name of ['Light', 'Dark', 'System']) {
    expect(within(theme).getByRole('menuitemradio', { name })).toBeTruthy();
  }
});

it('reaches the theme and language items with the keyboard and selects with Enter', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  screen.getByRole('button', { name: 'Account menu' }).focus();
  await user.keyboard('{Enter}');
  const dark = await screen.findByRole('menuitemradio', { name: 'Dark' });
  const ms = screen.getByRole('menuitemradio', { name: 'Bahasa Melayu' });
  const focusOrder: Element[] = [];
  for (let i = 0; i < 12 && !(focusOrder.includes(dark) && focusOrder.includes(ms)); i++) {
    await user.keyboard('{ArrowDown}');
    focusOrder.push(document.activeElement as Element);
    if (document.activeElement === dark) {
      await user.keyboard('{Enter}');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(dark.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('menu')).toBeTruthy(); // stays open
    }
  }
  expect(focusOrder).toContain(dark);
  expect(document.activeElement === ms || focusOrder.includes(ms)).toBe(true);
  while (document.activeElement !== ms) await user.keyboard('{ArrowDown}');
  await user.keyboard('{Enter}');
  expect(changeLocale).toHaveBeenCalledWith('ms');
  expect(screen.getByRole('menu')).toBeTruthy();
});

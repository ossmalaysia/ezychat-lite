import { cleanup, render, screen } from '@testing-library/react';
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
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthShell } from '@/auth/AuthShell';
import { UserMenu } from '@/auth/UserMenu';

const auth = vi.hoisted(() => ({
  user: { displayName: 'Support Agent', username: 'agent', role: 'member' },
  isAdmin: false,
  logout: vi.fn(),
}));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.3' }));
vi.mock('@/pwa/PushToggle', () => ({ PushToggle: () => null }));
vi.mock('@/i18n/use-change-locale', () => ({
  useChangeLocale: () => ({ locale: 'en', changeLocale: vi.fn() }),
}));
vi.mock('@/lib/theme', () => ({
  THEME_OPTIONS: [],
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

afterEach(cleanup);

it('offers a feature-request draft before signing in', () => {
  render(<AuthShell title="Sign in">Login form</AuthShell>);
  const action = screen.getByRole('link', { name: /Request a feature/ });
  expect(action.getAttribute('href')).toBe(
    'https://github.com/ossmalaysia/ezychat-lite/issues/new?template=feature_request.yml',
  );
  expect(action.getAttribute('target')).toBe('_blank');
  expect(action.getAttribute('rel')).toBe('noopener noreferrer');
});

it.each([false, true])('offers the request action to an account with admin=%s', async (isAdmin) => {
  auth.isAdmin = isAdmin;
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Account menu' }));
  const action = screen.getByRole('menuitem', { name: /Request a feature/ });
  expect(action.tagName).toBe('A');
  expect(action.getAttribute('href')).toBe(
    'https://github.com/ossmalaysia/ezychat-lite/issues/new?template=feature_request.yml',
  );
  expect(action.getAttribute('target')).toBe('_blank');
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthShell } from '@/auth/AuthShell';
import { UserMenu } from '@/auth/UserMenu';
import { feedbackUrl } from '@/lib/links';

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

it('keeps the sign-in screen to Report an issue; feature requests live in the account menu', () => {
  render(<AuthShell title="Sign in">Login form</AuthShell>);
  expect(screen.queryByRole('link', { name: /Request a feature/ })).toBeNull();
  const report = screen.getByRole('link', { name: 'Report an issue' });
  expect(report.getAttribute('target')).toBe('_blank');
  expect(report.getAttribute('rel')).toBe('noopener noreferrer');
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
  expect(action.getAttribute('href')).toBe('https://ezychat.ai/feedback?v=0.1.3');
  expect(action.getAttribute('target')).toBe('_blank');
});

it.each([
  ['en', '0.1.30', 'https://ezychat.ai/feedback?v=0.1.30'],
  ['ms', '0.1.30', 'https://ezychat.ai/ms/feedback?v=0.1.30'],
  ['zh-CN', '0.1.30', 'https://ezychat.ai/zh/feedback?v=0.1.30'],
  ['fr', null, 'https://ezychat.ai/feedback'],
])('builds the feedback link for locale %s and version %s', (locale, version, url) => {
  expect(feedbackUrl(locale, version)).toBe(url);
});

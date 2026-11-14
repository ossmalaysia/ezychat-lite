// App navigation: the account menu as a page (phones: the Account tab, or Settings → Your account).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppLinksProvider } from '@/lib/app-links';
import { resolveAppLinks } from '@/lib/links';
import { AccountPage } from './AccountPage';

const auth = vi.hoisted(() => ({
  user: { id: 1, username: 'ali', displayName: 'Ali Bin Abu', role: 'agent', locale: null } as {
    id: number;
    username: string;
    displayName: string;
    role: 'admin' | 'agent';
    locale: null;
  },
  isAdmin: false,
  logout: vi.fn(),
}));
const changeLocale = vi.hoisted(() => vi.fn());
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/i18n/use-change-locale', () => ({
  useChangeLocale: () => ({ locale: 'en', changeLocale }),
}));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.84' }));
vi.mock('../pwa/PushToggle', () => ({ PushToggle: () => <p>Notifications</p> }));
const feedback = vi.hoisted(() => vi.fn());
vi.mock('@/components/app/FeedbackDialog', () => ({ openFeedback: feedback }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

function setup(links: Parameters<typeof resolveAppLinks>[0] = {}) {
  render(
    <MemoryRouter>
      <AppLinksProvider links={resolveAppLinks(links)}>
        <AccountPage />
      </AppLinksProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  auth.user.role = 'agent';
  auth.isAdmin = false;
  auth.logout.mockReset().mockResolvedValue(undefined);
  feedback.mockReset();
  toast.error.mockReset();
  changeLocale.mockReset();
});
afterEach(cleanup);

it('shows who is signed in, the version, and the same items as the account menu', async () => {
  const user = setup();
  const page = within(screen.getByTestId('account-page'));
  expect(page.getByText('Ali Bin Abu')).toBeTruthy();
  expect(page.getByText(/@ali/)).toBeTruthy();
  expect(page.getByText(/0\.1\.84/)).toBeTruthy();
  expect(page.getByText('Notifications')).toBeTruthy();
  expect(page.getByRole('link', { name: 'Change password' }).getAttribute('href')).toBe(
    '/change-password',
  );
  // agents cannot buy
  expect(page.queryByRole('link', { name: /Upgrade/ })).toBeNull();
  await user.click(page.getByRole('button', { name: 'Send feedback' }));
  expect(feedback).toHaveBeenCalledOnce();
  await user.click(page.getByRole('radio', { name: 'BM' }));
  expect(changeLocale).toHaveBeenCalledWith('ms');
  await user.click(page.getByRole('button', { name: 'Sign out' }));
  expect(auth.logout).toHaveBeenCalledOnce();
});

it('signs out once at a time, and says so when signing out fails', async () => {
  let finish!: (e?: Error) => void;
  auth.logout.mockImplementation(
    () => new Promise<void>((resolve, reject) => (finish = (e) => (e ? reject(e) : resolve()))),
  );
  const user = setup();
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  const busy = screen.getByRole('button', { name: 'Signing out…' }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  expect(busy.getAttribute('aria-busy')).toBe('true');
  await user.click(busy);
  expect(auth.logout).toHaveBeenCalledOnce();
  await act(async () => finish(new Error('Server unreachable')));
  expect(toast.error).toHaveBeenCalledWith('Could not sign out: Server unreachable');
  const retry = screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(false);
});

it('a team member has no way back to Settings (the Account tab is their own place)', () => {
  setup();
  expect(within(screen.getByTestId('phone-bar')).queryByRole('link')).toBeNull();
});

it('an admin gets the upgrade link and a way back to the Settings list', () => {
  auth.user.role = 'admin';
  auth.isAdmin = true;
  setup();
  expect(screen.getByRole('link', { name: 'Back to Settings' }).getAttribute('href')).toBe(
    '/admin',
  );
  const upgrade = screen.getAllByRole('link').find((l) => l.getAttribute('target') === '_blank');
  expect(upgrade?.getAttribute('rel')).toBe('noopener noreferrer');
});

it('an edition without an issue tracker shows its support email', () => {
  setup({ reportIssue: null, supportEmail: 'help@example.com' });
  expect(screen.getByRole('link', { name: 'Email support' }).getAttribute('href')).toBe(
    'mailto:help@example.com',
  );
});

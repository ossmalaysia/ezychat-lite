import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UserMenu } from '@/auth/UserMenu';
import { SHARE_APP_CAPTION, SHARE_APP_URL } from '@/lib/share-app';
import type * as ShareAppModule from '@/lib/share-app';
import { ShareAppAction } from './ShareAppAction';

const auth = vi.hoisted(() => ({
  user: { displayName: 'Support Agent', username: 'agent', role: 'member' },
  isAdmin: false,
  logout: vi.fn(),
}));
const actions = vi.hoisted(() => ({
  copyShareText: vi.fn(),
  shareApp: vi.fn(),
  downloadShareCard: vi.fn(),
}));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.6' }));
vi.mock('@/pwa/PushToggle', () => ({ PushToggle: () => null }));
vi.mock('@/i18n/use-change-locale', () => ({
  useChangeLocale: () => ({ locale: 'en', changeLocale: vi.fn() }),
}));
vi.mock('@/lib/theme', () => ({
  THEME_OPTIONS: [],
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/lib/share-app', async (importOriginal) => ({
  ...(await importOriginal<typeof ShareAppModule>()),
  ...actions,
}));

beforeEach(() => {
  actions.copyShareText.mockReset().mockResolvedValue(undefined);
  actions.shareApp.mockReset().mockResolvedValue('shared');
  actions.downloadShareCard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
});

it.each([false, true])('opens Share this app from the account menu (admin=%s)', async (isAdmin) => {
  auth.isAdmin = isAdmin;
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Account menu' }));
  await user.click(screen.getByRole('menuitem', { name: 'Share this app' }));
  expect(screen.getByRole('dialog', { name: 'Share this app' })).toBeTruthy();
  expect(actions.copyShareText).not.toHaveBeenCalled();
  expect(actions.shareApp).not.toHaveBeenCalled();
  expect(actions.downloadShareCard).not.toHaveBeenCalled();
});

it('copies the edited caption with a fixed public link and copies the link independently', async () => {
  const user = userEvent.setup();
  render(<ShareAppAction open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), {
    target: { value: 'Our team uses this!' },
  });
  await user.click(screen.getByRole('button', { name: 'Copy message and link' }));
  expect(actions.copyShareText).toHaveBeenCalledWith(`Our team uses this!\n\n${SHARE_APP_URL}`);
  await user.click(screen.getByRole('button', { name: 'Copy link only' }));
  expect(actions.copyShareText).toHaveBeenLastCalledWith(SHARE_APP_URL);
  expect(screen.getByRole('status').textContent).toBe('Public app link copied.');
  for (const platform of ['LinkedIn', 'Facebook']) {
    const link = screen.getByRole('link', { name: new RegExp(platform) });
    expect(link.getAttribute('href')).not.toContain('Our team');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
});

it('keeps the caption selectable and explains manual copying if clipboard permission fails', async () => {
  actions.copyShareText.mockRejectedValue(new Error('Denied'));
  const user = userEvent.setup();
  render(<ShareAppAction open onOpenChange={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Copy message and link' }));
  expect(screen.getByRole('status').textContent).toContain('copy it manually');
  expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe(
    SHARE_APP_CAPTION,
  );
});

it('gives an Instagram download and manual posting instructions', async () => {
  const user = userEvent.setup();
  render(<ShareAppAction open onOpenChange={vi.fn()} />);
  expect(screen.getByText(/create a post in Instagram/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Download Instagram image' }));
  expect(actions.downloadShareCard).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('Image download started');
  expect(screen.getByRole('status').textContent).not.toContain('posted');
});

it('shows useful feedback when preparing an Instagram image fails', async () => {
  actions.downloadShareCard.mockRejectedValue(new Error('Canvas unavailable'));
  render(<ShareAppAction open onOpenChange={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Download Instagram image' }));
  expect(screen.getByRole('status').textContent).toContain('Could not prepare the image');
});

it.each(['cancelled', 'copied'])(
  'handles native sharing result %s without claiming a post',
  async (result) => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn() });
    actions.shareApp.mockResolvedValue(result);
    render(<ShareAppAction open onOpenChange={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'More sharing options' }));
    expect(actions.shareApp).toHaveBeenCalledWith(SHARE_APP_CAPTION);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'More sharing options' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    expect(screen.getByRole('status').textContent).toBe(
      result === 'cancelled' ? '' : 'Message and public link copied. Paste them into your post.',
    );
  },
);

it('offers manual selection if both native sharing and copying fail', async () => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn() });
  actions.shareApp.mockRejectedValue(new Error('Unavailable'));
  render(<ShareAppAction open onOpenChange={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'More sharing options' }));
  expect(screen.getByRole('status').textContent).toContain('copy it manually');
});

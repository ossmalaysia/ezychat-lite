import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppLinksProvider } from '@/lib/app-links';
import { ENTERPRISE_UPGRADE_URL, resolveAppLinks } from '@/lib/links';
import { UserMenu } from '@/auth/UserMenu';
import { AboutDialog } from './AboutDialog';
import { UpgradeButton, UpgradeNote } from './UpgradeEnterprise';

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: 'aisyah',
      displayName: 'Aisyah',
      role: auth.isAdmin ? 'admin' : 'agent',
      locale: null,
    },
    isAdmin: auth.isAdmin,
    logout: vi.fn(),
  }),
}));
vi.mock('@/i18n/use-change-locale', () => ({
  useChangeLocale: () => ({ locale: 'en', changeLocale: vi.fn() }),
}));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.0' }));
vi.mock('@/pwa/PushToggle', () => ({ PushToggle: () => null }));

afterEach(() => {
  cleanup();
  auth.isAdmin = true;
});

/** Renders with Lite's links, or with the upgrade link hidden like another product does. */
function renderWith(node: ReactNode, upgrade?: null) {
  const links = resolveAppLinks(upgrade === null ? { upgrade: null } : {});
  return render(
    <MemoryRouter>
      <AppLinksProvider links={links}>{node}</AppLinksProvider>
    </MemoryRouter>,
  );
}

it('opens the Enterprise page in a new tab from Lite', () => {
  renderWith(<UpgradeButton />);
  const link = screen.getByRole('link', { name: 'Upgrade to Enterprise' });
  expect(link.getAttribute('href')).toBe(ENTERPRISE_UPGRADE_URL);
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
});

it('explains each Lite limit in its own words', () => {
  renderWith(
    <>
      <UpgradeNote reason="agents" />
      <UpgradeNote reason="numbers" />
    </>,
  );
  const [agents, numbers] = screen.getAllByTestId('upgrade-note');
  expect(agents!.textContent).toContain('one AI agent for each WhatsApp number');
  expect(numbers!.textContent).toContain('links several numbers to one team inbox');
});

it('shows no button and no note when the product hides the upgrade link', () => {
  renderWith(
    <>
      <UpgradeButton />
      <UpgradeNote reason="agents" />
    </>,
    null,
  );
  expect(screen.queryByTestId('upgrade-enterprise')).toBeNull();
  expect(screen.queryByTestId('upgrade-note')).toBeNull();
});

it('About shows the Enterprise text and button in Lite, nothing when hidden', () => {
  const { unmount } = renderWith(<AboutDialog open onOpenChange={() => {}} version="1.0.0" />);
  const about = screen.getByTestId('about-upgrade');
  expect(about.textContent).toContain('with support from Anchor Sprint');
  expect(within(about).getByRole('link', { name: 'Upgrade to Enterprise' })).toBeTruthy();
  unmount();
  renderWith(<AboutDialog open onOpenChange={() => {}} version="1.0.0" />, null);
  expect(screen.queryByTestId('about-upgrade')).toBeNull();
});

async function openMenu() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Account menu' }));
}

it('the account menu offers the upgrade to admins only', async () => {
  const { unmount } = renderWith(<UserMenu />);
  await openMenu();
  const item = screen.getByRole('menuitem', { name: 'Upgrade to Enterprise' });
  expect(item.getAttribute('href')).toBe(ENTERPRISE_UPGRADE_URL);
  expect(item.getAttribute('target')).toBe('_blank');
  unmount();

  auth.isAdmin = false;
  renderWith(<UserMenu />);
  await openMenu();
  expect(screen.queryByRole('menuitem', { name: 'Upgrade to Enterprise' })).toBeNull();
});

it('the account menu has no upgrade item when the product hides it', async () => {
  renderWith(<UserMenu />, null);
  await openMenu();
  expect(screen.getByRole('menuitem', { name: 'Admin settings' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Upgrade to Enterprise' })).toBeNull();
});

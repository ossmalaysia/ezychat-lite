import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout, ADMIN_NAV } from './AdminLayout';
import { reportClientError } from '@/lib/error-reporter';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'admin' }, isLoading: false }),
}));
vi.mock('../pwa/PushToggle', () => ({ PushToggle: () => null }));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.0' }));
vi.mock('@/lib/error-reporter', () => ({ reportClientError: vi.fn() }));
vi.mock('@/components/app', () => ({ AppCredits: () => null }));
vi.mock('./MembersPage', () => ({ MembersPage: () => <h1>Members</h1> }));
vi.mock('./QuickRepliesPage', () => ({ QuickRepliesPage: () => <h1>Quick replies</h1> }));
vi.mock('./WhatsAppPage', () => ({ WhatsAppPage: () => <h1>WhatsApp</h1> }));
vi.mock('./TunnelPage', () => ({ TunnelPage: () => <h1>Cloudflare</h1> }));
vi.mock('./SettingsPage', () => ({ SettingsPage: () => <h1>Settings</h1> }));
vi.mock('./AuditPage', () => ({ AuditPage: () => <h1>Audit</h1> }));

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function setup(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

afterEach(cleanup);

describe('AdminLayout routing', () => {
  it.each(ADMIN_NAV)('keeps every admin link anchored from $label', async ({ to }) => {
    const user = setup(`/admin/${to}`);
    for (const destination of ADMIN_NAV) {
      const link = screen.getByRole('link', { name: destination.label });
      // Check before clicking so a broken relative fallback cannot enter an endless loop.
      expect(link.getAttribute('href')).toBe(`/admin/${destination.to}`);
      await user.click(link);
      expect(screen.getByRole('heading', { name: destination.label })).toBeTruthy();
      expect(screen.getByTestId('location').textContent).toBe(`/admin/${destination.to}`);
      expect(
        screen.getByRole('link', { name: destination.label }).getAttribute('aria-current'),
      ).toBe('page');
    }
  });

  it.each(['/admin', '/admin/', '/admin/members/quick-replies/members/members', '/admin/unknown'])(
    'recovers %s to the canonical Members page',
    async (path) => {
      setup(path);
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe('/admin/members'),
      );
      expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy();
    },
  );

  it('reports an unmatched route for server-side diagnostics', async () => {
    setup('/admin/members/quick-replies');
    await waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith({
        kind: 'error',
        message: 'Unmatched admin route',
        route: '/admin/members/quick-replies',
      }),
    );
    expect(screen.getByTestId('location').textContent).toBe('/admin/members');
  });

  it('opens every section from the mobile menu and closes the sheet', async () => {
    const user = setup('/admin/members');
    for (const destination of ADMIN_NAV) {
      await user.click(screen.getByRole('button', { name: 'Admin menu' }));
      const menu = await screen.findByRole('dialog');
      const link = within(menu).getByRole('link', { name: destination.label });
      expect(link.getAttribute('href')).toBe(`/admin/${destination.to}`);
      await user.click(link);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('heading', { name: destination.label })).toBeTruthy();
      expect(screen.getByTestId('location').textContent).toBe(`/admin/${destination.to}`);
    }
  });
});

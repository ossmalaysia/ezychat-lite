import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout, visibleAdminNav } from './AdminLayout';
import { i18n } from '@/i18n';
import { reportClientError } from '@/lib/error-reporter';
import { ANCHOR_SPRINT_URL, CUSTOM_FEATURE_URL } from '@/lib/links';

type InboxRow = { id: number; removed: boolean; status: { state: string } };
/** What `useInboxes()` returns: Lite (`maxInboxes` 1) unless a test changes it. */
const inboxes = vi.hoisted(() => ({
  current: { data: { inboxes: [], maxInboxes: 1, canAdd: false }, isPending: false } as {
    data?: { inboxes: InboxRow[]; maxInboxes: number; canAdd: boolean };
    isPending: boolean;
  },
}));

/** What `useAiAgents()` returns: Lite with agent 1 unless a test changes it. */
const agents = vi.hoisted(() => ({
  current: {
    data: { agents: [{ id: 1 }], maxAgents: 1 },
    isPending: false,
    isError: false,
  } as {
    data?: { agents: { id: number }[]; maxAgents: number };
    isPending: boolean;
    isError: boolean;
  },
}));

vi.mock('../api/queries', () => ({ useInboxes: () => inboxes.current }));
vi.mock('../api/ai', () => ({ useAiAgents: () => agents.current }));
vi.mock('./InboxesPage', () => ({ InboxesPage: () => <h1>Inboxes</h1> }));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { role: 'admin', displayName: 'Aisyah Rahman' },
    isAdmin: true,
    isLoading: false,
  }),
}));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.0' }));
vi.mock('@/lib/error-reporter', () => ({ reportClientError: vi.fn() }));
vi.mock('./AiMemberPage', () => ({ AiMemberPage: () => <h1>AI member page</h1> }));
vi.mock('./MembersPage', () => ({ MembersPage: () => <h1>Members</h1> }));
vi.mock('./QuickRepliesPage', () => ({ QuickRepliesPage: () => <h1>Quick replies</h1> }));
vi.mock('./WhatsAppPage', () => ({ WhatsAppPage: () => <h1>WhatsApp</h1> }));
vi.mock('./TunnelPage', () => ({ TunnelPage: () => <h1>Phone access</h1> }));
vi.mock('./SettingsPage', () => ({ SettingsPage: () => <h1>App settings</h1> }));
vi.mock('./AuditPage', () => ({ AuditPage: () => <h1>Audit</h1> }));
vi.mock('./connectors/ConnectorsGalleryPage', () => ({
  ConnectorsGalleryPage: () => <h1>Connectors</h1>,
}));
vi.mock('./connectors/ConnectorDetailPage', () => ({
  ConnectorDetailPage: () => <h1>Connector page</h1>,
}));
vi.mock('./ReportsPage', () => ({ ReportsPage: () => <h1>Reports</h1> }));
vi.mock('./SafetyPage', () => ({ SafetyPage: () => <h1>Safety</h1> }));

const label = (key: string) => i18n.t(`admin:${key}`);
/** The pages under Settings (the side menu); Reports and Members are rail places of their own. */
const SETTINGS_NAV = visibleAdminNav(false)
  .filter((n) => n.to !== 'reports' && n.to !== 'members')
  .map((n) => ({ ...n, label: label(n.labelKey) }));

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function setup(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<h1>Inbox</h1>} />
        <Route path="/account" element={<h1>Account</h1>} />
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

/** The page's own heading (the phone app bar names the page too). */
const pageHeading = (name: string) =>
  within(screen.getByTestId('admin-main')).getByRole('heading', { name });
const sideMenu = () => within(screen.getByTestId('settings-nav'));
const phoneBar = () => screen.getByTestId('phone-bar');

/** From 768 px the app shows the desktop layout. */
function desktop(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: on,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const LITE = { data: { inboxes: [], maxInboxes: 1, canAdd: false }, isPending: false };
const MULTI = { data: { inboxes: [], maxInboxes: 3, canAdd: true }, isPending: false };

beforeEach(() => {
  inboxes.current = LITE;
  agents.current = {
    data: { agents: [{ id: 1 }], maxAgents: 1 },
    isPending: false,
    isError: false,
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminLayout routing', () => {
  it.each(SETTINGS_NAV)('keeps every Settings link anchored from $label', async ({ to }) => {
    const user = setup(`/admin/${to}`);
    for (const destination of SETTINGS_NAV) {
      const link = sideMenu().getByRole('link', { name: destination.label });
      // Check before clicking so a broken relative fallback cannot enter an endless loop.
      expect(link.getAttribute('href')).toBe(`/admin/${destination.to}`);
      await user.click(link);
      expect(pageHeading(destination.label)).toBeTruthy();
      expect(screen.getByTestId('location').textContent).toBe(`/admin/${destination.to}`);
      expect(
        sideMenu().getByRole('link', { name: destination.label }).getAttribute('aria-current'),
      ).toBe('page');
    }
    // the rail places are not in the Settings menu
    expect(sideMenu().queryByRole('link', { name: 'Reports' })).toBeNull();
    expect(sideMenu().queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it.each(['/admin/reports', '/admin/members', '/admin/members/ai/1'])(
    'shows %s full width, without the Settings side menu',
    (path) => {
      setup(path);
      expect(screen.queryByTestId('settings-nav')).toBeNull();
    },
  );

  it('names the Settings area "App settings" for its own page', () => {
    setup('/admin/settings');
    expect(sideMenu().getByRole('link', { name: 'App settings' })).toBeTruthy();
    expect(i18n.t('admin:nav.settings')).toBe('App settings');
  });

  it.each([
    '/admin/members/quick-replies/members/members',
    '/admin/members/ai/1/extra',
    '/admin/unknown',
  ])('recovers %s to App settings', async (path) => {
    setup(path);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/settings'));
    expect(pageHeading('App settings')).toBeTruthy();
  });

  it.each([
    '/admin/members/ai/unknown',
    '/admin/members/ai/0',
    '/admin/members/ai/01',
    '/admin/members/ai/2x',
  ])('recovers %s to the Members page', async (path) => {
    setup(path);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/members'));
    expect(pageHeading('Members')).toBeTruthy();
  });

  it('opens App settings on /admin from 768 px', async () => {
    desktop(true);
    setup('/admin');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/settings'));
  });

  it('lists every admin page on the phone Settings page, the numbers first under Business', async () => {
    desktop(false);
    const user = setup('/admin');
    const home = within(screen.getByTestId('settings-home'));
    expect(screen.getByTestId('location').textContent).toBe('/admin');
    const hrefs = home.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual([
      '/admin/members',
      '/admin/quick-replies',
      '/admin/whatsapp',
      '/admin/safety',
      '/admin/connectors',
      '/admin/tunnel',
      '/admin/settings',
      '/admin/audit',
      '/account',
    ]);
    for (const group of ['Team', 'Business', 'App', 'Your account'])
      expect(home.getByRole('heading', { name: group })).toBeTruthy();
    expect(home.getByRole('link', { name: 'Aisyah Rahman' })).toBeTruthy();
    // the Settings list is a tab's own page: no back arrow
    expect(within(phoneBar()).queryByRole('link')).toBeNull();
    expect(phoneBar().textContent).toBe('Settings');
    await user.click(home.getByRole('link', { name: 'Quick replies' }));
    expect(pageHeading('Quick replies')).toBeTruthy();
  });

  it('labels the tunnel section Phone access and keeps its /admin/tunnel route', () => {
    setup('/admin/settings');
    const link = sideMenu().getByRole('link', { name: 'Phone access' });
    expect(link.getAttribute('href')).toBe('/admin/tunnel');
    expect(screen.queryByRole('link', { name: 'Cloudflare' })).toBeNull();
  });

  it.each([
    ['/admin/reports', 'Reports', null],
    ['/admin/members', 'Members', '/admin'],
    ['/admin/members/ai/7', 'Members', '/admin/members'],
    ['/admin/settings/ai', 'App settings', '/admin'],
    ['/admin/connectors', 'Connectors', '/admin'],
    ['/admin/connectors/google-calendar', 'Connectors', '/admin/connectors'],
    ['/admin/audit', 'Audit', '/admin'],
  ])('the phone app bar of %s says %s and goes back to %s', (path, title, back) => {
    setup(path);
    expect(within(phoneBar()).getByRole('heading').textContent).toBe(title);
    const link = within(phoneBar()).queryByRole('link');
    expect(link?.getAttribute('href') ?? null).toBe(back);
  });

  it('opens the new-agent page with its preset', () => {
    render(
      <MemoryRouter initialEntries={['/admin/members/ai/new?preset=faq']}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
        <Location />
      </MemoryRouter>,
    );
    expect(pageHeading('AI member page')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/admin/members/ai/new');
  });

  it('sends Lite from /admin/members/ai to its one agent', async () => {
    setup('/admin/members/ai');
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/members/ai/1'),
    );
    expect(pageHeading('AI member page')).toBeTruthy();
  });

  it('sends Lite with no agent yet from /admin/members/ai to a new agent', async () => {
    agents.current = { data: { agents: [], maxAgents: 1 }, isPending: false, isError: false };
    setup('/admin/members/ai');
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/members/ai/new'),
    );
  });

  it('sends Enterprise from /admin/members/ai to Members, where every agent is listed', async () => {
    agents.current = {
      data: { agents: [{ id: 1 }, { id: 2 }], maxAgents: 3 },
      isPending: false,
      isError: false,
    };
    setup('/admin/members/ai');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/members'));
    expect(pageHeading('Members')).toBeTruthy();
  });

  it('waits for the agent list on /admin/members/ai, and falls back to Members on an error', async () => {
    agents.current = { data: undefined, isPending: true, isError: false };
    setup('/admin/members/ai');
    expect(screen.getByLabelText('Loading').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('location').textContent).toBe('/admin/members/ai');
    cleanup();
    agents.current = { data: undefined, isPending: false, isError: true };
    setup('/admin/members/ai');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/members'));
  });

  it.each(['general', 'ai', 'device', 'maintenance'])(
    'keeps App settings current and mounted on /admin/settings/%s',
    (tab) => {
      setup(`/admin/settings/${tab}`);
      expect(pageHeading('App settings')).toBeTruthy();
      expect(
        sideMenu().getByRole('link', { name: 'App settings' }).getAttribute('aria-current'),
      ).toBe('page');
      expect(screen.getByTestId('location').textContent).toBe(`/admin/settings/${tab}`);
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
    expect(screen.getByTestId('location').textContent).toBe('/admin/settings');
  });

  it('keeps version and support destinations in the Settings side menu', async () => {
    const user = setup('/admin/audit');
    const tools = within(screen.getByLabelText('Admin tools and support'));
    expect(tools.getByText('v0.1.0')).toBeTruthy();
    await user.click(tools.getByRole('button', { name: 'Help & feedback' }));
    for (const [name, href] of [
      ['Anchor Sprint', ANCHOR_SPRINT_URL],
      ['Custom features', CUSTOM_FEATURE_URL],
    ]) {
      const link = tools.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(tools.getByRole('button', { name: 'Send feedback' })).toBeTruthy();
  });
});

describe('AdminLayout numbers that need attention', () => {
  const inbox = (state: string, removed = false): InboxRow => ({
    id: 1,
    removed,
    status: { state },
  });

  it.each(['qr', 'logged_out', 'disconnected', 'replaced', 'blocked'])(
    'marks the WhatsApp row when the number is %s',
    (state) => {
      inboxes.current = { ...LITE, data: { ...LITE.data, inboxes: [inbox(state)] } };
      setup('/admin/settings');
      const row = sideMenu().getByRole('link', { name: /WhatsApp/ });
      expect(within(row).getByTestId('settings-attention-dot')).toBeTruthy();
      expect(row.textContent).toContain('A WhatsApp number needs attention');
      cleanup();
      setup('/admin');
      const home = within(screen.getByTestId('settings-home'));
      expect(home.getByRole('link', { name: /WhatsApp/ }).textContent).toContain('Needs attention');
    },
  );

  it('shows no dot while connected, connecting, or for a removed inbox', () => {
    inboxes.current = {
      ...MULTI,
      data: { ...MULTI.data, inboxes: [inbox('open'), inbox('connecting'), inbox('qr', true)] },
    };
    setup('/admin/settings');
    expect(screen.queryByTestId('settings-attention-dot')).toBeNull();
  });
});

describe('AdminLayout inboxes', () => {
  it('shows WhatsApp, not Inboxes, in Lite (one number)', () => {
    setup('/admin/settings');
    expect(sideMenu().getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toBe(
      '/admin/whatsapp',
    );
    expect(screen.queryByRole('link', { name: 'Inboxes' })).toBeNull();
    expect(visibleAdminNav(false).map((n) => n.to)).not.toContain('inboxes');
  });

  it('sends Lite from /admin/inboxes back to its WhatsApp page', async () => {
    setup('/admin/inboxes');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/whatsapp'));
    expect(pageHeading('WhatsApp')).toBeTruthy();
  });

  it('keeps the WhatsApp page while the inbox list loads, and waits on /admin/inboxes', () => {
    inboxes.current = { data: undefined, isPending: true };
    setup('/admin/whatsapp');
    expect(pageHeading('WhatsApp')).toBeTruthy();
    cleanup();
    setup('/admin/inboxes');
    expect(screen.getByLabelText('Loading').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('location').textContent).toBe('/admin/inboxes');
  });

  it('shows Inboxes instead of WhatsApp when the edition allows several numbers', async () => {
    inboxes.current = MULTI;
    const user = setup('/admin/settings');
    expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull();
    const link = sideMenu().getByRole('link', { name: 'Inboxes' });
    expect(link.getAttribute('href')).toBe('/admin/inboxes');
    await user.click(link);
    expect(pageHeading('Inboxes')).toBeTruthy();
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(within(phoneBar()).getByRole('heading').textContent).toBe('Inboxes');
  });

  it('redirects /admin/whatsapp to /admin/inboxes with several numbers', async () => {
    inboxes.current = MULTI;
    setup('/admin/whatsapp');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/inboxes'));
    expect(pageHeading('Inboxes')).toBeTruthy();
  });
});

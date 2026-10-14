import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from '../App';
import { i18n } from '@/i18n';
import {
  registerExtensionCatalogs,
  validateWebExtensions,
  WebExtensionError,
  WebExtensionsProvider,
  type WebExtension,
} from './index';

let role: 'admin' | 'agent' = 'admin';
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { role, mustChangePassword: false },
    isLoading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
vi.mock('../api/queries', () => ({
  useSetupStatus: () => ({ isPending: false, data: { needsSetup: false } }),
  useSettings: () => ({
    isPending: false,
    isError: false,
    data: { port: 7420, lanEnabled: false, historyDays: 3 },
  }),
  usePatchSettings: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/lib/error-reporter', () => ({ reportClientError: vi.fn() }));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.0' }));
vi.mock('@/components/app/DesktopUpdates', () => ({ DesktopUpdateNotice: () => null }));
vi.mock('@/components/app/DevBuildBadge', () => ({ DevBuildBadge: () => null }));
vi.mock('../pwa/PushToggle', () => ({ PushToggle: () => null }));
vi.mock('@/i18n/use-change-locale', () => ({
  useChangeLocale: () => ({ locale: 'en', changeLocale: vi.fn() }),
}));
vi.mock('../inbox/InboxPage', () => ({ InboxPage: () => <h1>Inbox</h1> }));
vi.mock('../setup/SetupWizard', () => ({ SetupWizard: () => <h1>Setup</h1> }));
vi.mock('../auth/LoginPage', () => ({ LoginPage: () => <h1>Login</h1> }));
vi.mock('../auth/ChangePasswordPage', () => ({ ChangePasswordPage: () => <h1>Password</h1> }));
vi.mock('../admin/AiMemberPage', () => ({ AiMemberPage: () => <h1>AI member page</h1> }));
vi.mock('../admin/MembersPage', () => ({ MembersPage: () => <h1>Members</h1> }));
vi.mock('../admin/QuickRepliesPage', () => ({ QuickRepliesPage: () => <h1>Quick replies</h1> }));
vi.mock('../admin/WhatsAppPage', () => ({ WhatsAppPage: () => <h1>WhatsApp</h1> }));
vi.mock('../admin/TunnelPage', () => ({ TunnelPage: () => <h1>Cloudflare</h1> }));
vi.mock('../admin/AuditPage', () => ({ AuditPage: () => <h1>Audit</h1> }));
vi.mock('../admin/ResolveAllChatsCard', () => ({ ResolveAllChatsCard: () => null }));
vi.mock('../admin/AiConnectionSection', () => ({ AiConnectionSection: () => null }));
vi.mock('../admin/AiVoiceSection', () => ({ AiVoiceSection: () => null }));
vi.mock('../admin/CustomerEnrichmentSection', () => ({ CustomerEnrichmentSection: () => null }));
vi.mock('../admin/IntegrationsSection', () => ({
  IntegrationsSection: () => <p>AI assistant access</p>,
}));

function Boom(): never {
  throw new Error('extension exploded');
}

const demo: WebExtension = {
  name: 'demo',
  routes: [
    { path: 'x', element: <h1>Demo user page</h1> },
    { path: 'y', element: <h1>Demo admin page</h1>, admin: true },
    { path: 'boom', element: <Boom /> },
  ],
  adminNav: [{ path: 'y', labelKey: 'ext.demo.nav' }],
  settingsSections: [
    { id: 'prefs', titleKey: 'ext.demo.settings', element: <p>Demo settings body</p> },
    { id: 'broken', titleKey: 'ext.demo.broken', element: <Boom /> },
  ],
  catalogs: {
    en: {
      'ext.demo.nav': 'Demo reports',
      'ext.demo.settings': 'Demo preferences',
      'ext.demo.broken': 'Broken section',
    },
    ms: { 'ext.demo.nav': 'Laporan demo' },
  },
};

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderApp(path: string, extensions: readonly WebExtension[] = [demo]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <WebExtensionsProvider extensions={validateWebExtensions(extensions)}>
        <App />
      </WebExtensionsProvider>
      <Location />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await registerExtensionCatalogs([demo]);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

describe('Lite without extensions', () => {
  it('renders the core routes and admin nav as before', () => {
    renderApp('/', []);
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy();
    cleanup();
    renderApp('/admin/members', []);
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Demo reports' })).toBeNull();
  });

  it('still sends unknown /ext paths home', async () => {
    renderApp('/ext/demo/x', []);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });
});

describe('extension routes', () => {
  it('mounts a user route under /ext/<name>/', () => {
    renderApp('/ext/demo/x');
    expect(screen.getByRole('heading', { name: 'Demo user page' })).toBeTruthy();
  });

  it('mounts an admin route inside the admin shell with an absolute nav link', () => {
    renderApp('/admin/ext/demo/y');
    expect(screen.getByRole('heading', { name: 'Demo admin page' })).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Demo reports' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/admin/ext/demo/y');
      expect(link.getAttribute('aria-current')).toBe('page');
    }
    // Core nav is still there.
    expect(screen.getAllByRole('link', { name: 'Members' })[0]?.getAttribute('href')).toBe(
      '/admin/members',
    );
  });

  it('redirects a non-admin away from an extension admin route', async () => {
    role = 'agent';
    renderApp('/admin/ext/demo/y');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(screen.queryByRole('heading', { name: 'Demo admin page' })).toBeNull();
  });

  it('does not expose admin routes at the user prefix or vice versa', async () => {
    renderApp('/ext/demo/y');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  it('can never shadow a core path', () => {
    const shadow: WebExtension = {
      name: 'shadow',
      routes: [
        { path: 'members', element: <h1>Shadow members</h1>, admin: true },
        { path: 'chats/:jid', element: <h1>Shadow chat</h1> },
      ],
    };
    renderApp('/admin/members', [shadow]);
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Shadow members' })).toBeNull();
    cleanup();
    renderApp('/chats/123', [shadow]);
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(() =>
      validateWebExtensions([{ name: 'bad', routes: [{ path: '/admin/members', element: null }] }]),
    ).toThrow(WebExtensionError);
    expect(() =>
      validateWebExtensions([{ name: 'bad', routes: [{ path: '../members', element: null }] }]),
    ).toThrow(WebExtensionError);
  });

  it('catches a throwing extension element in an ErrorBoundary', () => {
    renderApp('/ext/demo/boom');
    expect(screen.getByTestId('error-boundary').textContent).toContain('extension exploded');
  });
});

describe('extension settings sections', () => {
  it('renders sections in Settings → Integrations, each behind its own boundary', () => {
    renderApp('/admin/settings/integrations');
    expect(screen.getByText('AI assistant access')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Demo preferences' })).toBeTruthy();
    expect(screen.getByText('Demo settings body')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Broken section' })).toBeTruthy();
    expect(screen.getByTestId('error-boundary').textContent).toContain('extension exploded');
  });

  it('adds nothing to Settings in Lite', () => {
    renderApp('/admin/settings/integrations', []);
    expect(screen.getByText('AI assistant access')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Demo preferences' })).toBeNull();
  });
});

describe('extension catalogs', () => {
  it('translates nav labels and falls back to English for missing keys', async () => {
    await i18n.changeLanguage('ms');
    const t = i18n.t as unknown as (key: string) => string;
    expect(t('ext.demo.nav')).toBe('Laporan demo');
    expect(t('ext.demo.settings')).toBe('Demo preferences');
    // Core keys are untouched.
    expect(i18n.t('admin:nav.members', { lng: 'en' })).toBe('Members');
  });
});

describe('validateWebExtensions', () => {
  it.each([
    ['too short', { name: 'a' }],
    ['upper case', { name: 'Demo' }],
    ['leading digit', { name: '1demo' }],
    ['reserved lite', { name: 'lite' }],
    ['reserved core', { name: 'core' }],
    ['too long', { name: `a${'b'.repeat(32)}` }],
    ['catalog key without prefix', { name: 'demo', catalogs: { en: { 'nav.members': 'X' } } }],
    [
      'catalog key of another extension',
      { name: 'demo', catalogs: { en: { 'ext.other.a': 'X' } } },
    ],
    ['unknown locale', { name: 'demo', catalogs: { fr: { 'ext.demo.a': 'X' } } }],
    [
      'nav label without prefix',
      {
        name: 'demo',
        routes: [{ path: 'y', element: null, admin: true }],
        adminNav: [{ path: 'y', labelKey: 'nav.members' }],
      },
    ],
    [
      'nav to a missing admin route',
      { name: 'demo', adminNav: [{ path: 'y', labelKey: 'ext.demo.y' }] },
    ],
    [
      'bad section id',
      { name: 'demo', settingsSections: [{ id: 'A b', titleKey: 'ext.demo.t', element: null }] },
    ],
    [
      'duplicate route',
      {
        name: 'demo',
        routes: [
          { path: 'x', element: null },
          { path: 'x', element: null },
        ],
      },
    ],
  ])('rejects %s', (_label, ext) => {
    expect(() => validateWebExtensions([ext as WebExtension])).toThrow(WebExtensionError);
  });

  it('rejects duplicate names', () => {
    expect(() => validateWebExtensions([{ name: 'demo' }, { name: 'demo' }])).toThrow(/Duplicate/);
  });

  it('accepts a valid extension and an empty list', () => {
    expect(validateWebExtensions([demo])).toEqual([demo]);
    expect(validateWebExtensions([])).toEqual([]);
  });
});

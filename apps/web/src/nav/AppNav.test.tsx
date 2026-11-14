// App navigation (docs/features/app-navigation/design.md): rail from 768 px, bottom tabs below; places, counts and
// the attention dot per role.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AskEzyProvider, useAskEzy } from '../askezy/AskEzyContext';
import { WebExtensionsProvider, type WebExtension } from '../extensions';
import { AppShell, placeOf } from './AppNav';

type Role = 'admin' | 'agent';
const auth = vi.hoisted(() => ({
  user: { role: 'admin' as Role, chatScope: 'all' as 'all' | 'chosen', displayName: 'Aisyah' },
  isAdmin: true,
}));
const data = vi.hoisted(() => ({
  unread: 0,
  inboxes: [] as { id: number; removed: boolean; status: { state: string } }[],
  maxInboxes: 1,
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../auth/UserMenu', () => ({ UserMenu: () => <span data-testid="user-menu" /> }));
vi.mock('../api/queries', () => ({
  useUnreadChatCount: () => ({ data: { count: data.unread } }),
  useInboxes: () => ({
    data: { inboxes: data.inboxes, maxInboxes: data.maxInboxes, canAdd: false },
  }),
}));

function AskState() {
  return <output data-testid="ask-open">{String(useAskEzy().open)}</output>;
}

function setup(path: string, extensions: readonly WebExtension[] = []) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <WebExtensionsProvider extensions={extensions}>
        <AskEzyProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<h1>Page</h1>} />
            </Route>
          </Routes>
          <AskState />
        </AskEzyProvider>
      </WebExtensionsProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const rail = () => within(screen.getByTestId('app-rail'));
const tabs = () => within(screen.getByTestId('app-tabs'));
/** The destinations of a bar, in order (the account photo is a separate mock). */
const names = (testId: 'app-rail' | 'app-tabs') =>
  [...screen.getByTestId(testId).querySelectorAll('a, button')].map((el) =>
    el.getAttribute('data-testid'),
  );

function as(role: Role, chatScope: 'all' | 'chosen' = 'all') {
  auth.user.role = role;
  auth.user.chatScope = chatScope;
  auth.isAdmin = role === 'admin';
}

beforeEach(() => {
  as('admin');
  data.unread = 0;
  data.inboxes = [];
  data.maxInboxes = 1;
});
afterEach(cleanup);

describe('places per role', () => {
  it('admin: rail Chats, Reports, Ask Ezy, Members, Settings; tabs Chats, Reports, Ask Ezy, Settings', () => {
    setup('/');
    expect(names('app-rail')).toEqual([
      'nav-chats',
      'nav-reports',
      'nav-ask-ezy',
      'nav-members',
      'nav-settings',
    ]);
    expect(rail().getByTestId('user-menu')).toBeTruthy();
    expect(names('app-tabs')).toEqual(['tab-chats', 'tab-reports', 'tab-ask-ezy', 'tab-settings']);
    expect(tabs().getByTestId('tab-settings').getAttribute('href')).toBe('/admin');
    expect(rail().getByTestId('nav-settings').getAttribute('href')).toBe('/admin/settings');
  });

  it('team member: no admin places; the last tab is Account', () => {
    as('agent');
    setup('/');
    expect(names('app-rail')).toEqual(['nav-chats', 'nav-ask-ezy']);
    expect(names('app-tabs')).toEqual(['tab-chats', 'tab-ask-ezy', 'tab-account']);
    expect(tabs().getByTestId('tab-account').getAttribute('href')).toBe('/account');
  });

  it('an agent limited to chosen chats gets no Ask Ezy', () => {
    as('agent', 'chosen');
    setup('/');
    expect(names('app-rail')).toEqual(['nav-chats']);
    expect(names('app-tabs')).toEqual(['tab-chats', 'tab-account']);
  });

  it('hides the tabs inside an open chat, never the rail', () => {
    setup('/chats/60123%40s.whatsapp.net');
    expect(screen.queryByTestId('app-tabs')).toBeNull();
    expect(screen.getByTestId('app-rail')).toBeTruthy();
  });
});

describe('current place', () => {
  it.each([
    ['/', 'admin', 'chats'],
    ['/chats/x', 'admin', 'chats'],
    ['/admin/reports', 'admin', 'reports'],
    ['/admin/members/ai/1', 'admin', 'members'],
    ['/admin', 'admin', 'settings'],
    ['/admin/settings/ai', 'admin', 'settings'],
    ['/account', 'admin', 'settings'],
    ['/account', 'agent', 'account'],
    ['/ext/demo/x', 'agent', null],
    ['/chatsx', 'admin', null],
  ] as const)('%s for an %s is %s', (path, role, place) => {
    expect(placeOf(path, role === 'admin')).toBe(place);
  });

  it('an extension page under a core section takes that section', () => {
    expect(placeOf('/admin/ext/x/agents', true, 'members')).toBe('members');
    expect(placeOf('/admin/ext/x/stats', true, 'reports')).toBe('reports');
  });

  it('marks the current place with aria-current, in the rail and the tabs', () => {
    setup('/admin/reports');
    expect(rail().getByTestId('nav-reports').getAttribute('aria-current')).toBe('page');
    expect(rail().getByTestId('nav-chats').getAttribute('aria-current')).toBeNull();
    expect(tabs().getByTestId('tab-reports').getAttribute('aria-current')).toBe('page');
  });

  it('on phones Members is under Settings', () => {
    setup('/admin/members');
    expect(rail().getByTestId('nav-members').getAttribute('aria-current')).toBe('page');
    expect(tabs().getByTestId('tab-settings').getAttribute('aria-current')).toBe('page');
  });
});

describe('Ask Ezy', () => {
  it('the rail button opens and closes the panel and shows it as pressed', async () => {
    const user = setup('/');
    const button = rail().getByTestId('nav-ask-ezy');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await user.click(button);
    expect(screen.getByTestId('ask-open').textContent).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await user.click(button);
    expect(screen.getByTestId('ask-open').textContent).toBe('false');
  });

  it('while open, the tab of the page is not current (Ask Ezy covers it on phones)', async () => {
    const user = setup('/admin/reports');
    await user.click(tabs().getByTestId('tab-ask-ezy'));
    expect(tabs().getByTestId('tab-ask-ezy').getAttribute('aria-pressed')).toBe('true');
    expect(tabs().getByTestId('tab-reports').getAttribute('aria-current')).toBeNull();
    // the rail keeps the page current beside the docked panel
    expect(rail().getByTestId('nav-reports').getAttribute('aria-current')).toBe('page');
  });
});

describe('counts and dots', () => {
  it('shows the unread chat count, capped at 99+, with an accessible name', () => {
    data.unread = 120;
    setup('/');
    const chats = rail().getByTestId('nav-chats');
    expect(within(chats).getByTestId('nav-unread-count').textContent).toBe('99+');
    expect(chats.textContent).toContain('120 chats with unread messages');
    cleanup();
    data.unread = 1;
    setup('/');
    expect(rail().getByTestId('nav-chats').textContent).toContain('1 chat with unread messages');
    cleanup();
    data.unread = 0;
    setup('/');
    expect(screen.queryByTestId('nav-unread-count')).toBeNull();
  });

  it('a number that needs an admin puts a dot on Settings and sends it to the number', () => {
    data.inboxes = [{ id: 1, removed: false, status: { state: 'qr' } }];
    setup('/');
    const settings = rail().getByTestId('nav-settings');
    expect(within(settings).getByTestId('nav-attention-dot')).toBeTruthy();
    expect(settings.textContent).toContain('A WhatsApp number needs attention');
    expect(settings.getAttribute('href')).toBe('/admin/whatsapp');
    expect(
      within(tabs().getByTestId('tab-settings')).getByTestId('nav-attention-dot'),
    ).toBeTruthy();
    cleanup();
    data.maxInboxes = 3;
    setup('/');
    expect(rail().getByTestId('nav-settings').getAttribute('href')).toBe('/admin/inboxes');
  });

  it('team members never see the dot', () => {
    data.inboxes = [{ id: 1, removed: false, status: { state: 'logged_out' } }];
    as('agent');
    setup('/');
    expect(screen.queryByTestId('nav-attention-dot')).toBeNull();
  });

  it("an extension's attention badge raises the dot; a crashing badge hook hides nothing else", () => {
    const ext = (useBadge: () => { attention?: boolean } | null): WebExtension => ({
      name: 'demo',
      adminNav: [{ path: 'x', labelKey: 'ext.demo.x', useBadge }],
    });
    setup('/', [ext(() => ({ attention: true }))]);
    expect(
      within(rail().getByTestId('nav-settings')).getByTestId('nav-attention-dot'),
    ).toBeTruthy();
    // an extension's attention keeps App settings as the target (only a number goes to the numbers page)
    expect(rail().getByTestId('nav-settings').getAttribute('href')).toBe('/admin/settings');
    cleanup();
    setup('/', [ext(() => ({ attention: false }))]);
    expect(screen.queryByTestId('nav-attention-dot')).toBeNull();
    cleanup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup('/', [
      ext(() => {
        throw new Error('badge exploded');
      }),
    ]);
    expect(rail().getByTestId('nav-settings')).toBeTruthy();
    expect(screen.queryByTestId('nav-attention-dot')).toBeNull();
  });
});

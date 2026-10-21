import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { InboxListResponse, User } from '@ezychat/shared';
import { MembersPage } from './MembersPage';

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

const users: User[] = [
  {
    id: 1,
    username: 'admin',
    displayName: 'Alice Admin',
    role: 'admin',
    mustChangePassword: false,
    disabled: false,
    createdAt: 1_700_000_000_000,
    locale: null,
  },
  {
    id: 2,
    username: 'bob',
    displayName: 'Bob Agent',
    role: 'agent',
    mustChangePassword: false,
    disabled: true,
    createdAt: 1_700_000_100_000,
    locale: null,
  },
];
const aiUser: User = {
  ...users[1]!,
  id: 3,
  username: 'ai-assistant',
  displayName: 'Business AI',
  disabled: false,
  kind: 'ai',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const status = { state: 'open' as const, qr: null, me: null, lastError: null };
/** Two inboxes in an edition that allows three numbers. */
const multiInbox: InboxListResponse = {
  maxInboxes: 3,
  canAdd: true,
  inboxes: [
    { id: 1, name: 'Sales', tone: 'primary', number: '60111', status, removed: false },
    { id: 2, name: 'Catering', tone: 'warning', number: null, status, removed: false },
    { id: 3, name: 'Old', tone: 'info', number: null, status, removed: true },
  ],
};

function setup(memberList = users, inboxList?: InboxListResponse) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users' && method === 'GET') return json({ users: memberList });
    if (url === '/api/inboxes' && inboxList) return json(inboxList);
    if (url === '/api/users/2/inboxes' && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { inboxIds: number[] };
      return json({ ...memberList[1], inboxIds: body.inboxIds });
    }
    if (url === '/api/ai')
      return json({
        member: memberList.find((member) => member.kind === 'ai') ?? null,
        settings: {
          displayName: 'Business AI',
          enabled: false,
          mode: 'api',
          model: '',
          instructions: '',
        },
        hasApiKey: false,
        connection: { state: 'signed_out', loginUrl: null, error: null },
        documents: [],
      });
    if (url === '/api/users' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Partial<User>;
      return json({ ...users[1], ...body, id: 3, disabled: false, mustChangePassword: true }, 201);
    }
    if (url === '/api/me') return json(users[0]);
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/members']}>
        <Routes>
          <Route path="/admin/members" element={<MembersPage />} />
          <Route path="/admin/members/ai" element={<h1>AI member page</h1>} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

it('searches members by username and role and recovers from no results', async () => {
  setup();
  await screen.findAllByText('Alice Admin');
  const user = userEvent.setup();
  const search = screen.getByRole('searchbox', { name: 'Search members' });
  await user.type(search, 'bob');
  expect(screen.queryByText('Alice Admin')).toBeNull();
  expect(screen.getAllByText('Bob Agent').length).toBeGreaterThan(0);
  await user.clear(search);
  await user.type(search, 'admin');
  expect(screen.queryByText('Bob Agent')).toBeNull();
  await user.clear(search);
  await user.type(search, 'not-a-member');
  expect(screen.getByText('No matching members')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /^Clear search$/ }));
  expect(screen.getAllByText('Bob Agent').length).toBeGreaterThan(0);
});

// Radix Select relies on pointer-capture / scrollIntoView, which jsdom lacks.
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MembersPage', () => {
  it('opens the AI member page from the AI row and shows its AI badge', async () => {
    setup([...users, aiUser]);
    await screen.findAllByText('Business AI');
    expect(screen.getAllByText('AI · Sales Agent').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Add AI member' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions for Business AI' })).toBeNull();
    const user = userEvent.setup();
    const edit = screen.getAllByRole('link', { name: 'Edit Business AI' })[0]!;
    expect(edit.getAttribute('href')).toBe('/admin/members/ai');
    await user.click(edit);
    expect(screen.getByTestId('location').textContent).toBe('/admin/members/ai');
  });

  it('shows a turned-off AI member as a neutral Off, not as Disabled', async () => {
    setup([users[0]!, { ...aiUser, disabled: true }]);
    await screen.findAllByText('Business AI');
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);
    expect(screen.queryByText('Disabled')).toBeNull();
  });

  it('shows the date a member was added without the time', async () => {
    setup();
    await screen.findAllByText('Alice Admin');
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).toBeNull();
    expect(screen.getAllByText(/2023/).length).toBeGreaterThan(0);
  });

  it('links Add AI member to the AI member page when there is no AI member', async () => {
    setup();
    const link = await screen.findByRole('link', { name: 'Add AI member' });
    expect(link.getAttribute('href')).toBe('/admin/members/ai');
  });

  it('renders users from the users query', async () => {
    setup();
    expect((await screen.findAllByText('Alice Admin')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob Agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/disabled/i).length).toBeGreaterThan(0);
  });

  it('opens the create modal and submits typed values to the create mutation', async () => {
    const fetchMock = setup();
    const user = userEvent.setup();
    await screen.findAllByText('Alice Admin');

    await user.click(screen.getByRole('button', { name: /add member/i }));
    const dialog = await screen.findByRole('dialog');
    const d = within(dialog);

    await user.type(d.getByLabelText(/^username/i), 'carol');
    await user.type(d.getByLabelText(/display name/i), 'Carol Chan');
    await user.click(d.getByRole('combobox', { name: /role/i }));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));
    const pw = d.getByLabelText(/temporary password/i) as HTMLInputElement;
    await user.clear(pw);
    await user.type(pw, 'temp-pass-123');
    await user.click(d.getByRole('button', { name: /create member/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/users' && (c[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
        username: 'carol',
        displayName: 'Carol Chan',
        role: 'admin',
        password: 'temp-pass-123',
      });
    });
  });

  it('generates a temporary password by default', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Alice Admin');
    await user.click(screen.getByRole('button', { name: /add member/i }));
    const dialog = await screen.findByRole('dialog');
    const pw = within(dialog).getByLabelText(/temporary password/i) as HTMLInputElement;
    expect(pw.value.length).toBeGreaterThanOrEqual(12);
  });
});

describe('MembersPage inbox access', () => {
  const agent = { ...users[1]!, disabled: false, inboxIds: [] as number[] };

  it('shows no inbox access in Lite (one number)', async () => {
    setup([users[0]!, agent]);
    await screen.findAllByText('Bob Agent');
    expect(screen.queryByText('Inbox access')).toBeNull();
    expect(screen.queryByTestId('inbox-access')).toBeNull();
  });

  it("warns 'No inbox: this agent sees no chats' and saves the ticked inboxes", async () => {
    const fetchMock = setup([users[0]!, agent, aiUser], multiInbox);
    const warnings = await screen.findAllByText('No inbox: this agent sees no chats');
    expect(warnings.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inbox access').length).toBeGreaterThan(0);
    expect(screen.getAllByText('All inboxes (admin)').length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Inboxes for Bob Agent' })[0]!);
    const dialog = await screen.findByRole('dialog');
    // Removed inboxes cannot be ticked.
    expect(within(dialog).queryByText('Old')).toBeNull();
    expect(within(dialog).getByText('+60111')).toBeTruthy();
    await user.click(within(dialog).getByRole('checkbox', { name: /Catering/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/users/2/inboxes' && init?.method === 'PUT',
        ),
      ).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([url]) => url === '/api/users/2/inboxes')!;
    expect(JSON.parse(String(put[1]?.body))).toEqual({ inboxIds: [2] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the chips of the inboxes an agent may open', async () => {
    setup([users[0]!, { ...agent, inboxIds: [1, 3] }], multiInbox);
    const chips = await screen.findAllByTestId('inbox-chip');
    expect(chips.map((c) => c.textContent)).toContain('Sales');
    expect(chips.map((c) => c.textContent)).not.toContain('Old');
    expect(screen.queryByText('No inbox: this agent sees no chats')).toBeNull();
  });

  it('keeps the dialog open with the server error when saving fails', async () => {
    const fetchMock = setup([users[0]!, { ...agent, inboxIds: [1] }], multiInbox);
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/users/2/inboxes'
        ? json({ error: { code: 'validation', message: 'Unknown inbox' } }, 400)
        : base(url, init),
    );
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Inboxes for Bob Agent' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('checkbox', { name: /Sales/ }).getAttribute('aria-checked') ??
        within(dialog).getByRole('checkbox', { name: /Sales/ }).getAttribute('data-state'),
    ).toMatch(/true|checked/);
    await user.click(within(dialog).getByRole('checkbox', { name: /Sales/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Unknown inbox')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

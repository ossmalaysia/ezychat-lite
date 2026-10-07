import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { User } from '@wa-team-inbox/shared';
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

function setup(memberList = users) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users' && method === 'GET') return json({ users: memberList });
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

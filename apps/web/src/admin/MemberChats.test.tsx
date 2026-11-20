import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  DEFAULT_INBOX_CAPABILITIES,
  type Chat,
  type InboxListResponse,
  type MemberChatsResponse,
  type User,
} from '@ezychat/shared';
import { MembersPage } from './MembersPage';

const A = '60123000111@s.whatsapp.net';
const B = '60123000222@s.whatsapp.net';
const G = '120363000000000001@g.us';

const admin: User = {
  id: 1,
  username: 'admin',
  displayName: 'Alice Admin',
  role: 'admin',
  mustChangePassword: false,
  disabled: false,
  createdAt: 1_700_000_000_000,
  locale: null,
};
const bob: User = { ...admin, id: 2, username: 'bob', displayName: 'Bob Agent', role: 'agent' };
const ravi: User = {
  ...bob,
  id: 5,
  username: 'ravi',
  displayName: 'Ravi Kumar',
  chatScope: 'chosen',
  chatJids: [A, G],
};

const chat = (jid: string, name: string, type: 'dm' | 'group' = 'dm'): Chat => ({
  jid,
  inboxId: 1,
  waJid: jid,
  type,
  name,
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: 1,
  lastInboundAt: null,
  lastMessagePreview: null,
  status: 'open',
  assignedTo: null,
  updatedAt: 1,
  phone: null,
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const status = { state: 'open' as const, qr: null, me: null, lastError: null };
const twoInboxes: InboxListResponse = {
  maxInboxes: 3,
  canAdd: true,
  inboxes: [1, 2].map((id) => ({
    id,
    name: `Inbox ${id}`,
    tone: 'primary' as const,
    number: null,
    status,
    removed: false,
    aiAgentId: null,
    type: 'linked_phone',
    capabilities: DEFAULT_INBOX_CAPABILITIES,
  })),
};

function setup(opts: {
  members?: User[];
  chats?: Record<number, MemberChatsResponse>;
  inboxes?: InboxListResponse;
  putStatus?: number;
  chatList?: Chat[];
}) {
  const members = opts.members ?? [admin, bob];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/ai/agents') return json({ agents: [], maxAgents: 1 });
    if (url === '/api/users' && method === 'GET') return json({ users: members });
    if (url === '/api/inboxes' && opts.inboxes) return json(opts.inboxes);
    if (url === '/api/me') return json(admin);
    if (url.startsWith('/api/chats?')) {
      const params = new URLSearchParams(url.split('?')[1]);
      const q = (params.get('q') ?? '').toLowerCase().replace(/\D/g, '') || params.get('q') || '';
      const all = opts.chatList ?? [
        chat(A, 'Ann'),
        chat(G, 'Regulars', 'group'),
        chat(B, 'Bob Customer'),
      ];
      const hit = all.filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q.toLowerCase()) ||
          (c.phone ?? '').includes(q) ||
          c.waJid.includes(q),
      );
      // two chats a page, so a search has to reach the later pages
      const from = Number(params.get('cursor') ?? 0);
      const page = hit.slice(from, from + 2);
      return json({ chats: page, nextCursor: from + 2 < hit.length ? String(from + 2) : null });
    }
    const m = /^\/api\/users\/(\d+)\/chats$/.exec(url);
    if (m && method === 'GET')
      return json(opts.chats?.[Number(m[1])] ?? { scope: 'all', chats: [] });
    if (m && method === 'PUT') {
      if (opts.putStatus)
        return json({ error: { code: 'unknown_chat', message: 'Unknown chat' } }, opts.putStatus);
      const body = JSON.parse(String(init?.body)) as { scope: 'all' | 'chosen'; chats: string[] };
      return json({
        scope: body.scope,
        chats: body.chats.map((jid) => ({ jid, name: jid, type: 'dm' })),
      });
    }
    if (/^\/api\/users\/\d+$/.exec(url) && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Partial<User>;
      return json({ ...bob, ...body });
    }
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof setup>, method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === path && (init?.method ?? 'GET') === method);

async function openEdit(name: string) {
  const user = userEvent.setup();
  const row = (await screen.findAllByText(name))[0]!.closest('tr, li') as HTMLElement;
  await user.click(within(row).getAllByRole('button', { name: /Edit/ })[0]!);
  return { user, dialog: await screen.findByRole('dialog') };
}

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

it('notes an agent limited to chosen chats under the role and replaces the inbox access cell', async () => {
  setup({ members: [admin, bob, ravi], inboxes: twoInboxes });
  const notes = await screen.findAllByTestId('chosen-chats-note');
  expect(notes[0]!.textContent).toBe('Only 2 chosen chats');
  const row = screen.getAllByText('Ravi Kumar')[0]!.closest('tr') as HTMLElement;
  expect(within(row).getByText('—')).toBeTruthy();
  expect(within(row).queryByRole('button', { name: 'Inboxes for Ravi Kumar' })).toBeNull();
});

it('says "No chats chosen" for a limited agent with none', async () => {
  setup({ members: [admin, { ...ravi, chatJids: [] }] });
  expect((await screen.findAllByTestId('chosen-chats-note'))[0]!.textContent).toBe(
    'No chats chosen',
  );
});

it('Edit member: All chats by default; Only chosen chats adds from the search and saves the keys', async () => {
  const fetchMock = setup({});
  const { user, dialog } = await openEdit('Bob Agent');
  const field = within(dialog).getByTestId('member-chats');
  expect(
    within(field)
      .getByRole('radio', { name: /All chats/ })
      .getAttribute('aria-checked'),
  ).toBe('true');
  await user.click(within(field).getByRole('radio', { name: /Only chosen chats/ }));
  expect(within(field).getByText(/No chats chosen yet/)).toBeTruthy();
  await user.click(await within(field).findByRole('button', { name: 'Add Ann' }));
  await user.click(within(field).getByRole('button', { name: 'Add Bob Customer' }));
  expect(within(field).getByText('2 chats chosen')).toBeTruthy();
  await user.type(within(field).getByRole('searchbox'), 'zzz');
  expect(await within(field).findByText('No other chats match.')).toBeTruthy();
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/users/2/chats')).toHaveLength(1));
  const body = JSON.parse(String(calls(fetchMock, 'PUT', '/api/users/2/chats')[0]![1]!.body));
  expect(body).toEqual({ scope: 'chosen', chats: [A, B] });
  expect(calls(fetchMock, 'PATCH', '/api/users/2')).toHaveLength(0);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('removes a chosen chat and saves together with a new name', async () => {
  const fetchMock = setup({
    members: [admin, ravi],
    chats: {
      5: {
        scope: 'chosen',
        chats: [
          { jid: A, name: 'Ann', type: 'dm' },
          { jid: G, name: 'Regulars', type: 'group' },
        ],
      },
    },
  });
  const { user, dialog } = await openEdit('Ravi Kumar');
  await within(dialog).findByTestId('chosen-chats');
  await user.click(within(dialog).getByRole('button', { name: 'Remove Ann' }));
  const name = within(dialog).getByLabelText('Display name');
  await user.clear(name);
  await user.type(name, 'Ravi K');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/users/5/chats')).toHaveLength(1));
  expect(JSON.parse(String(calls(fetchMock, 'PUT', '/api/users/5/chats')[0]![1]!.body))).toEqual({
    scope: 'chosen',
    chats: [G],
  });
  expect(calls(fetchMock, 'PATCH', '/api/users/5')).toHaveLength(1);
});

it('hides the setting for an admin role and saves only the role', async () => {
  const fetchMock = setup({});
  const { user, dialog } = await openEdit('Bob Agent');
  await user.click(within(dialog).getByRole('radio', { name: /Only chosen chats/ }));
  await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
  await user.click(await screen.findByRole('option', { name: 'Admin' }));
  expect(within(dialog).queryByTestId('member-chats')).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/users/2')).toHaveLength(1));
  expect(calls(fetchMock, 'PUT', '/api/users/2/chats')).toHaveLength(0);
});

it('keeps the dialog open with the server error when saving the chats fails', async () => {
  setup({ putStatus: 400 });
  const { user, dialog } = await openEdit('Bob Agent');
  await user.click(within(dialog).getByRole('radio', { name: /Only chosen chats/ }));
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(await within(dialog).findByText('Unknown chat')).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('closes without a call when nothing changed', async () => {
  const fetchMock = setup({});
  const { user, dialog } = await openEdit('Bob Agent');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls(fetchMock, 'PUT', '/api/users/2/chats')).toHaveLength(0);
  expect(calls(fetchMock, 'PATCH', '/api/users/2')).toHaveLength(0);
});

const many = [
  ...Array.from({ length: 12 }, (_, i) =>
    chat(`6019000${String(i).padStart(4, '0')}@s.whatsapp.net`, `Recent ${i}`),
  ),
  {
    ...chat('60177777777@s.whatsapp.net', 'Old Customer'),
    phone: '60177777777',
    status: 'resolved' as const,
  },
  chat('120363000000000011@g.us', 'AS x Kaki Deco', 'group'),
  chat('120363000000000022@g.us', 'AS x Kaki Deco', 'group'),
];

async function openChosenPicker(opts: Parameters<typeof setup>[0]) {
  const fetchMock = setup(opts);
  const { user, dialog } = await openEdit('Bob Agent');
  await user.click(within(dialog).getByRole('radio', { name: /Only chosen chats/ }));
  const field = within(dialog).getByTestId('member-chats');
  return { fetchMock, user, field };
}

it('finds an older resolved chat and a chat by a typed phone number through the server search', async () => {
  const { fetchMock, user, field } = await openChosenPicker({ chatList: many });
  // empty search: a short list of recent chats, no status filter
  expect((await within(field).findAllByRole('button', { name: /^Add Recent/ })).length).toBe(10);
  expect(within(field).queryByRole('button', { name: 'Add Old Customer' })).toBeNull();
  await user.type(within(field).getByRole('searchbox'), '+60 17-777 7777');
  await user.click(await within(field).findByRole('button', { name: 'Add Old Customer' }));
  expect(within(field).getByText('1 chat chosen')).toBeTruthy();
  const searched = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('q='));
  expect(searched.length).toBeGreaterThan(0);
  expect(searched.every((u) => !u.includes('status='))).toBe(true);
});

it('shows a chat once, tells same-named groups apart and leaves out the chosen ones', async () => {
  const { user, field } = await openChosenPicker({ chatList: [...many, many[0]!] });
  await user.type(within(field).getByRole('searchbox'), 'kaki');
  const add = await within(field).findAllByRole('button', { name: 'Add AS x Kaki Deco' });
  expect(add).toHaveLength(2);
  expect(add[0]!.textContent).toContain('…000011');
  expect(add[1]!.textContent).toContain('…000022');
  await user.click(add[0]!);
  // the chosen group leaves the add list; the other one with the same name stays
  expect(within(field).getAllByRole('button', { name: 'Add AS x Kaki Deco' })).toHaveLength(1);
  expect(within(field).getAllByText('AS x Kaki Deco').length).toBe(2);
  await user.clear(within(field).getByRole('searchbox'));
  await waitFor(() =>
    expect(within(field).getAllByRole('button', { name: /^Add Recent 0$/ })).toHaveLength(1),
  );
});

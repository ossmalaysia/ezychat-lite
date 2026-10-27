import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  DEFAULT_INBOX_CAPABILITIES,
  type Chat,
  type Inbox,
  type Message,
  type User,
  type WaStatus,
} from '@ezychat/shared';
import { InboxPage } from './InboxPage';

const me: User = {
  id: 1,
  username: 'alice',
  displayName: 'Alice',
  role: 'agent',
  mustChangePassword: false,
  disabled: false,
  createdAt: 0,
  locale: null,
};
const jid = '60123456789@s.whatsapp.net';
const now = Date.now();
const chat: Chat = {
  jid,
  inboxId: 1,
  waJid: jid,
  type: 'dm',
  name: 'Bob Customer',
  avatarUrl: null,
  unreadCount: 2,
  lastMessageAt: now,
  lastMessagePreview: 'Is it in stock?',
  status: 'open',
  assignedTo: 2,
  updatedAt: now,
  phone: '60123456789',
  lastInboundAt: null,
};
const base: Omit<Message, 'id' | 'body' | 'fromMe' | 'timestamp'> = {
  chatJid: jid,
  senderJid: jid,
  senderName: 'Bob',
  sentByUserId: null,
  type: 'text',
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  mediaStatus: 'none',
  quotedId: null,
  status: 'delivered',
  error: null,
  clientId: null,
  reactions: [],
};
const messages: Message[] = [
  { ...base, id: 'A1', body: 'Hello', fromMe: false, timestamp: now - 60_000 },
  { ...base, id: 'A2', body: 'Is it in stock?', fromMe: false, timestamp: now - 30_000 },
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(path: string, opts: { directory?: unknown[] } = {}) {
  const posted: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (url.endsWith('/messages'))
          return json(
            {
              ...base,
              id: 'local-x',
              body: 'hi',
              fromMe: true,
              timestamp: Date.now(),
              status: 'pending',
            },
            201,
          );
        return json({ ok: true });
      }
      if (url === '/api/me') return json(me);
      if (url === '/api/wa/status')
        return json({ state: 'open', me: null, qr: null, lastError: null });
      if (url.startsWith('/api/chats?')) return json({ chats: [chat], nextCursor: null });
      if (url.startsWith(`/api/chats/${encodeURIComponent(jid)}/messages`))
        return json({ messages, nextBefore: null });
      if (url === `/api/chats/${encodeURIComponent(jid)}/notes`) return json([]);
      if (url === `/api/chats/${encodeURIComponent(jid)}/profile`)
        return json({
          profile: {
            name: 'Bob Tan',
            company: 'Bob Bakery',
            email: null,
            otherPhone: null,
            address: null,
            tags: ['VIP'],
            updatedAt: null,
            updatedBy: null,
          },
          whatsappName: 'Bob',
        });
      if (url === `/api/chats/${encodeURIComponent(jid)}`) return json({ chat, events: [] });
      if (url === '/api/quick-replies') return json([]);
      if (url === '/api/users/directory' && opts.directory) return json({ users: opts.directory });
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }),
  );
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<InboxPage />} />
          <Route path="/chats/:jid" element={<InboxPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { posted };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InboxPage', () => {
  it('lists chats with unread badge', async () => {
    setup('/');
    expect(await screen.findByText('Bob Customer')).toBeTruthy();
    expect(screen.getByLabelText('2 unread')).toBeTruthy();
    expect(screen.getByText('Select a chat')).toBeTruthy();
  });

  it('opens a conversation, marks it read and confirms before replying to a chat assigned to someone else', async () => {
    const { posted } = setup(`/chats/${encodeURIComponent(jid)}`);
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(await within(log).findByText('Hello')).toBeTruthy();
    expect(posted.some((p) => p.url.endsWith('/read'))).toBe(true);

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'hi{Enter}');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Assigned to Agent #2/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /reply anyway/i }));
    await vi.waitFor(() => {
      const send = posted.find((p) => p.url.endsWith('/messages'));
      expect(send?.body).toMatchObject({ text: 'hi' });
    });
  });

  it('reacts to a customer message from the 🙂 button', async () => {
    const { posted } = setup(`/chats/${encodeURIComponent(jid)}`);
    const log = await screen.findByRole('log', { name: 'Messages' });
    const bubble = (await within(log).findByText('Hello')).closest('[data-message-id]')!;
    const row = bubble.parentElement as HTMLElement;
    const user = userEvent.setup();
    await user.click(within(row).getByTestId('reaction-picker-button'));
    await user.click(await screen.findByRole('button', { name: 'React with 🙏' }));
    await vi.waitFor(() =>
      expect(posted).toContainEqual({ url: '/api/messages/A1/reaction', body: { emoji: '🙏' } }),
    );
  });

  it('agents see teammate names from the team directory', async () => {
    setup(`/chats/${encodeURIComponent(jid)}`, {
      directory: [
        { id: 1, displayName: 'Alice', role: 'agent', disabled: false },
        { id: 2, displayName: 'Carol', role: 'agent', disabled: false },
      ],
    });
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(await within(log).findByText('Hello')).toBeTruthy();
    // Assignee pill in the chat list + assignee option in the header use the real name.
    expect((await screen.findAllByText('Carol')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Agent #2/)).toBeNull();
  });
  it('follows an old phone-number link to the WhatsApp ID chat', async () => {
    const lid = '123456789012345@lid';
    const merged: Chat = { ...chat, jid: lid };
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true });
        if (url === '/api/me') return json(me);
        if (url === '/api/wa/status')
          return json({ state: 'open', me: null, qr: null, lastError: null });
        if (url.startsWith('/api/chats?')) return json({ chats: [merged], nextCursor: null });
        if (
          url === `/api/chats/${encodeURIComponent(jid)}` ||
          url === `/api/chats/${encodeURIComponent(lid)}`
        )
          return json({ chat: merged, events: [] });
        if (url.startsWith(`/api/chats/${encodeURIComponent(lid)}/messages`))
          return json({
            messages: messages.map((m) => ({ ...m, chatJid: lid })),
            nextBefore: null,
          });
        if (url.startsWith(`/api/chats/${encodeURIComponent(jid)}/messages`))
          return json({ messages: [], nextBefore: null });
        if (url.endsWith('/notes')) return json([]);
        if (url === '/api/quick-replies') return json([]);
        return json({ error: { code: 'not_found', message: 'nope' } }, 404);
      }),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/chats/${encodeURIComponent(jid)}`]}>
          <Routes>
            <Route path="/chats/:jid" element={<InboxPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The PN conversation unmounts on redirect, so query the document, not its message log.
    expect(await screen.findByText('Hello', undefined, { timeout: 5000 })).toBeTruthy();
    expect(urls.some((u) => u.startsWith(`/api/chats/${encodeURIComponent(lid)}/messages`))).toBe(
      true,
    );
  });
  it('labels a nameless WhatsApp ID conversation without its digits', async () => {
    const lid = '123456789012345@lid';
    const nameless: Chat = { ...chat, jid: lid, name: '', phone: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true });
        if (url === '/api/me') return json(me);
        if (url === '/api/wa/status')
          return json({ state: 'open', me: null, qr: null, lastError: null });
        if (url.startsWith('/api/chats?')) return json({ chats: [nameless], nextCursor: null });
        if (url === `/api/chats/${encodeURIComponent(lid)}`)
          return json({ chat: nameless, events: [] });
        if (url.startsWith(`/api/chats/${encodeURIComponent(lid)}/messages`))
          return json({ messages: [], nextBefore: null });
        if (url.endsWith('/notes')) return json([]);
        if (url === '/api/quick-replies') return json([]);
        return json({ error: { code: 'not_found', message: 'nope' } }, 404);
      }),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/chats/${encodeURIComponent(lid)}`]}>
          <Routes>
            <Route path="/chats/:jid" element={<InboxPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('region', { name: 'Conversation with Unknown contact' }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('123456789012345');
  });
  it('remembers the tag filter and sends it with the chat list', async () => {
    sessionStorage.setItem(
      'wati.inbox.filters',
      JSON.stringify({ assigned: 'any', status: 'open', tag: 'VIP' }),
    );
    try {
      setup('/');
      await screen.findByText('Bob Customer');
      const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      expect(urls.find((u) => u.startsWith('/api/chats?'))).toContain('tag=VIP');
      expect(screen.getByRole('button', { name: 'Filter by tag' }).textContent).toContain('VIP');
    } finally {
      sessionStorage.clear();
    }
  });

  describe('customer edits on desktop', () => {
    const jid2 = '60199999999@s.whatsapp.net';
    const chat2: Chat = { ...chat, jid: jid2, name: 'Carol Customer', phone: '60199999999' };

    function setupDesktop(path: string) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('min-width'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }));
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true });
          if (url === '/api/me') return json(me);
          if (url === '/api/wa/status')
            return json({ state: 'open', me: null, qr: null, lastError: null });
          if (url.startsWith('/api/chats?'))
            return json({ chats: [chat, chat2], nextCursor: null });
          for (const c of [chat, chat2]) {
            const base = `/api/chats/${encodeURIComponent(c.jid)}`;
            if (url === base) return json({ chat: c, events: [] });
            if (url.startsWith(`${base}/messages`)) return json({ messages: [], nextBefore: null });
            if (url === `${base}/notes`) return json([]);
            if (url === `${base}/profile`)
              return json({
                profile: {
                  id: null,
                  name: c.name,
                  company: 'Bakery',
                  email: null,
                  otherPhone: null,
                  address: null,
                  tags: [],
                  updatedAt: null,
                  updatedBy: null,
                },
                whatsappName: c.name,
              });
          }
          if (url === '/api/quick-replies') return json([]);
          return json({ error: { code: 'not_found', message: 'nope' } }, 404);
        }),
      );
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/chats/:jid" element={<InboxPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }

    async function startEditing() {
      setupDesktop(`/chats/${encodeURIComponent(jid)}?customer=1`);
      await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      await userEvent.type(screen.getByLabelText('Company'), ' Sdn Bhd');
    }

    it('after discarding through the close button, the Notes toggle works again', async () => {
      await startEditing();
      await userEvent.click(screen.getByRole('button', { name: 'Close customer details' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
      expect(screen.queryByRole('complementary', { name: 'Customer' })).toBeNull();
      const notes = screen.getByRole('button', { name: /^Notes \(/ });
      await userEvent.click(notes);
      expect(notes.getAttribute('aria-pressed')).toBe('true');
      await userEvent.click(notes);
      expect(notes.getAttribute('aria-pressed')).toBe('false');
    });

    it('asks before switching chats with unsaved customer changes', async () => {
      await startEditing();
      await userEvent.click(screen.getByRole('link', { name: /Carol Customer/ }));
      expect(await screen.findByText('Discard your changes?')).toBeTruthy();
      // Still on the first chat (hidden from the accessibility tree behind the dialog).
      expect(
        screen.getByRole('region', { name: 'Conversation with Bob Customer', hidden: true }),
      ).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(
        await screen.findByRole('region', { name: 'Conversation with Carol Customer' }),
      ).toBeTruthy();
    });
  });

  it('opens the customer panel from a ?customer=1 link', async () => {
    setup(`/chats/${encodeURIComponent(jid)}?customer=1`);
    expect(await screen.findByText('Bob Bakery')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Customer details', hidden: true })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('InboxPage with inboxes', () => {
  const jid2 = `${jid}#2`;
  const chat2: Chat = { ...chat, jid: jid2, inboxId: 2, name: 'Bob at Catering', unreadCount: 0 };
  const status = (state: WaStatus['state']): WaStatus => ({
    state,
    me: null,
    qr: null,
    lastError: null,
  });
  const inbox = (id: number, name: string, state: WaStatus['state']): Inbox => ({
    id,
    name,
    tone: id === 1 ? 'primary' : 'warning',
    number: id === 1 ? '60123000001' : null,
    removed: false,
    aiAgentId: null,
    type: 'linked_phone',
    capabilities: DEFAULT_INBOX_CAPABILITIES,
    status: status(state),
  });

  function setupInboxes(path: string, inboxes: Inbox[] | null, wa: WaStatus['state'] = 'open') {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true });
        if (url === '/api/me') return json(me);
        if (url === '/api/wa/status') return json(status(wa));
        if (url === '/api/inboxes' && inboxes)
          return json({ inboxes, maxInboxes: 3, canAdd: false });
        if (url.startsWith('/api/chats?')) {
          const only = new URLSearchParams(url.split('?')[1]).get('inbox');
          const list = inboxes ? [chat, chat2] : [chat];
          return json({
            chats: only ? list.filter((c) => String(c.inboxId) === only) : list,
            nextCursor: null,
          });
        }
        for (const c of [chat, chat2]) {
          const base = `/api/chats/${encodeURIComponent(c.jid)}`;
          if (url === base) return json({ chat: c, events: [] });
          if (url.startsWith(`${base}/messages`)) return json({ messages, nextBefore: null });
          if (url === `${base}/notes`) return json([]);
        }
        if (url === '/api/quick-replies') return json([]);
        return json({ error: { code: 'not_found', message: 'nope' } }, 404);
      }),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<InboxPage />} />
            <Route path="/chats/:jid" element={<InboxPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { urls };
  }

  afterEach(() => sessionStorage.clear());

  it("one inbox shows no chip, no filter and today's banner text", async () => {
    setupInboxes(
      `/chats/${encodeURIComponent(jid)}`,
      [inbox(1, 'Kopi Apong', 'disconnected')],
      'disconnected',
    );
    await screen.findByRole('log', { name: 'Messages' });
    expect(await screen.findByText('WhatsApp is disconnected')).toBeTruthy();
    expect(screen.queryByTestId('inbox-chip')).toBeNull();
    expect(screen.queryByTestId('inbox-filter')).toBeNull();
    expect(screen.queryByText(/Kopi Apong/)).toBeNull();
  });

  it('two visible inboxes show the chip, the filter with counts, and "Catering is offline"', async () => {
    setupInboxes('/', [inbox(1, 'Kopi Apong', 'open'), inbox(2, 'Catering', 'disconnected')]);
    await screen.findByText('Bob at Catering');
    expect(await screen.findByText('Catering is offline')).toBeTruthy();
    expect(screen.getAllByTestId('inbox-chip').map((c) => c.textContent)).toEqual([
      'Kopi Apong',
      'Catering',
    ]);
    expect(screen.getByRole('combobox', { name: 'Inbox' }).textContent).toBe('All inboxes (2)');
  });

  it('the filter sets `inbox` in the chats query and is remembered', async () => {
    const proto = Element.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
    proto.scrollIntoView ??= () => {};
    const { urls } = setupInboxes('/', [
      inbox(1, 'Kopi Apong', 'open'),
      inbox(2, 'Catering', 'open'),
    ]);
    await screen.findByText('Bob at Catering');
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Inbox' }));
    await user.click(await screen.findByRole('option', { name: 'Catering' }));
    await vi.waitFor(() => expect(urls.some((u) => u.includes('inbox=2'))).toBe(true));
    await vi.waitFor(() => expect(screen.queryByText('Bob Customer')).toBeNull());
    expect(JSON.parse(sessionStorage.getItem('wati.inbox.filters')!)).toMatchObject({ inbox: 2 });
  });

  it('drops a remembered inbox the user can no longer open', async () => {
    sessionStorage.setItem(
      'wati.inbox.filters',
      JSON.stringify({ assigned: 'any', status: 'open', inbox: 2 }),
    );
    const { urls } = setupInboxes('/', null);
    await screen.findByText('Bob Customer');
    await vi.waitFor(() =>
      expect(urls.filter((u) => u.startsWith('/api/chats?')).at(-1)).not.toContain('inbox='),
    );
  });

  it('the composer of an inbox 1 chat is not blocked while inbox 2 is offline', async () => {
    setupInboxes(`/chats/${encodeURIComponent(jid)}`, [
      inbox(1, 'Kopi Apong', 'open'),
      inbox(2, 'Catering', 'logged_out'),
    ]);
    await screen.findByRole('log', { name: 'Messages' });
    expect(await screen.findByText('Catering was logged out')).toBeTruthy();
    const box = screen.getByRole('textbox', { name: /message/i });
    expect((box as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.queryByText('Sending is unavailable until WhatsApp is linked again.')).toBeNull();
    const header = screen.getByRole('heading', { level: 2 }).closest('header')!;
    expect(within(header).getByTestId('inbox-chip').textContent).toBe('Kopi Apong');
  });

  it('the composer of an inbox 2 chat follows inbox 2', async () => {
    setupInboxes(`/chats/${encodeURIComponent(jid2)}`, [
      inbox(1, 'Kopi Apong', 'open'),
      inbox(2, 'Catering', 'logged_out'),
    ]);
    await screen.findByRole('log', { name: 'Messages' });
    expect(
      await screen.findByText('Sending is unavailable until WhatsApp is linked again.'),
    ).toBeTruthy();
    const header = screen.getByRole('heading', { level: 2 }).closest('header')!;
    expect(within(header).getByTestId('inbox-chip').textContent).toBe('Catering');
  });
});

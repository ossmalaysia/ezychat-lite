import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chat, Message, User } from '@wa-team-inbox/shared';
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
  type: 'dm',
  name: 'Bob Customer',
  avatarUrl: null,
  unreadCount: 2,
  lastMessageAt: now,
  lastMessagePreview: 'Is it in stock?',
  status: 'open',
  assignedTo: 2,
  updatedAt: now,
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
          return json({ ...base, id: 'local-x', body: 'hi', fromMe: true, timestamp: Date.now(), status: 'pending' }, 201);
        return json({ ok: true });
      }
      if (url === '/api/me') return json(me);
      if (url === '/api/wa/status') return json({ state: 'open', me: null, qr: null, lastError: null });
      if (url.startsWith('/api/chats?')) return json({ chats: [chat], nextCursor: null });
      if (url.startsWith(`/api/chats/${encodeURIComponent(jid)}/messages`))
        return json({ messages, nextBefore: null });
      if (url === `/api/chats/${encodeURIComponent(jid)}/notes`) return json([]);
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
});

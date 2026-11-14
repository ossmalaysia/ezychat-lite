import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chat, Inbox, Message, User } from '@ezychat/shared';
import { InboxPage } from './InboxPage';
import { qk, type ChatsData } from '../api/queries';
import type * as Sonner from 'sonner';

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (orig) => {
  const real = await orig<typeof Sonner>();
  return { ...real, toast: Object.assign(real.toast, { success: toastSuccess }) };
});

const jid = '60123456789@s.whatsapp.net';
const enc = encodeURIComponent;
const user = (role: User['role']): User => ({
  id: 1,
  username: 'alice',
  displayName: 'Alice',
  role,
  mustChangePassword: false,
  disabled: false,
  createdAt: 0,
  locale: null,
});
const chat: Chat = {
  jid,
  inboxId: 1,
  waJid: jid,
  type: 'dm',
  name: 'Zamirin',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: Date.now(),
  lastMessagePreview: 'ya',
  status: 'open',
  assignedTo: null,
  updatedAt: Date.now(),
  phone: '60123456789',
  lastInboundAt: Date.now(),
};
const inbox: Inbox = {
  id: 1,
  name: 'Support',
  tone: 'primary',
  number: '60111',
  status: { state: 'open', me: null, qr: null, lastError: null },
  removed: false,
  aiAgentId: null,
  type: 'linked_phone',
  capabilities: {
    qrLink: true,
    history: true,
    groups: true,
    replyWindowHours: null,
    templates: false,
    needsPublicUrl: false,
  },
};
const message: Message = {
  id: 'A1',
  chatJid: jid,
  senderJid: jid,
  senderName: 'Zamirin',
  sentByUserId: null,
  type: 'text',
  body: 'Morning',
  fromMe: false,
  timestamp: Date.now() - 60_000,
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

function json(data: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(role: User['role'], opts: { failDelete?: boolean } = {}) {
  const deletes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE') {
        deletes.push(url);
        return opts.failDelete
          ? json(
              { error: { code: 'rate_limited', message: 'Too many attempts, retry in 5s' } },
              429,
            )
          : json(null, 204);
      }
      if (method !== 'GET') return json({ ok: true });
      if (url === '/api/me') return json(user(role));
      if (url === '/api/inboxes') return json({ inboxes: [inbox], maxInboxes: 1, canAdd: false });
      if (url === '/api/wa/status')
        return json({ state: 'open', me: null, qr: null, lastError: null });
      if (url.startsWith('/api/chats?')) return json({ chats: [chat], nextCursor: null });
      if (url === `/api/chats/${enc(jid)}/delete-preview`) return json({ messages: 48, files: 3 });
      if (url.startsWith(`/api/chats/${enc(jid)}/messages`))
        return json({ messages: [message], nextBefore: null });
      if (url === `/api/chats/${enc(jid)}/notes`) return json([]);
      if (url === `/api/chats/${enc(jid)}`) return json({ chat, events: [] });
      if (url === '/api/quick-replies') return json([]);
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }),
  );
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/chats/${enc(jid)}`]}>
        <Routes>
          <Route path="/chats/:jid" element={<InboxPage />} />
          <Route path="/" element={<p>Inbox home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { deletes, qc };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastSuccess.mockReset();
});

async function openConversation() {
  const log = await screen.findByRole('log', { name: 'Messages' });
  await within(log).findByText('Morning');
}

describe('Delete chat', () => {
  it('is not offered to an agent', async () => {
    setup('agent');
    await openConversation();
    expect(screen.queryByRole('button', { name: 'Chat actions' })).toBeNull();
    expect(screen.queryByText('Delete chat')).toBeNull();
  });

  it('lets an admin delete the chat: name and counts, then back to the inbox with a toast', async () => {
    const u = userEvent.setup();
    const { deletes, qc } = setup('admin');
    await openConversation();
    await u.click(screen.getByRole('button', { name: 'Chat actions' }));
    await u.click(await screen.findByRole('menuitem', { name: 'Delete chat' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this chat?' });
    await waitFor(() =>
      expect(within(dialog).getByTestId('delete-chat-summary').textContent).toBe(
        'Zamirin · 48 messages, 3 files',
      ),
    );
    expect(dialog.textContent).toContain(
      'Your WhatsApp phone keeps its copy. Backups keep it for up to 7 days.',
    );
    await u.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    expect(await screen.findByText('Inbox home')).toBeTruthy();
    expect(deletes).toEqual([`/api/chats/${enc(jid)}`]);
    expect(toastSuccess).toHaveBeenCalledWith('Chat deleted');
    for (const data of qc
      .getQueriesData<ChatsData>({ queryKey: qk.chatsAll })
      .map(([, d]) => d)
      .filter(Boolean))
      expect(data!.pages.flatMap((p) => p.chats).map((c) => c.jid)).not.toContain(jid);
  });

  it('keeps the dialog open with the reason when the delete fails, and Cancel closes it', async () => {
    const u = userEvent.setup();
    setup('admin', { failDelete: true });
    await openConversation();
    await u.click(screen.getByRole('button', { name: 'Chat actions' }));
    await u.click(await screen.findByRole('menuitem', { name: 'Delete chat' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this chat?' });
    await u.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    // the app's translated message, never the server's English text
    expect(await within(dialog).findByText('Too many attempts. Try again in 5 s.')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByText('Inbox home')).toBeNull();
  });
});

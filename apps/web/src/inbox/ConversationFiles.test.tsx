import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chat, Inbox, Message, User } from '@ezychat/shared';
import { InboxPage } from './InboxPage';

const HOUR = 3_600_000;
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
const chatAt = (lastInboundAt: number | null): Chat => ({
  jid,
  inboxId: 1,
  waJid: jid,
  type: 'dm',
  name: 'Bob Customer',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: Date.now(),
  lastMessagePreview: 'Is it in stock?',
  status: 'open',
  assignedTo: null,
  updatedAt: Date.now(),
  phone: '60123456789',
  lastInboundAt,
});
const apiInbox: Inbox = {
  id: 1,
  name: 'Support',
  tone: 'primary',
  number: '60111',
  status: { state: 'open', me: null, qr: null, lastError: null },
  removed: false,
  aiAgentId: null,
  type: 'wa-cloud',
  capabilities: {
    qrLink: false,
    history: false,
    groups: false,
    replyWindowHours: 24,
    templates: true,
    needsPublicUrl: true,
  },
};
const message: Message = {
  id: 'A1',
  chatJid: jid,
  senderJid: jid,
  senderName: 'Bob',
  sentByUserId: null,
  type: 'text',
  body: 'Hello',
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
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(chat: Chat) {
  const uploads: FormData[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/media')) {
        uploads.push(init!.body as FormData);
        return json({ ...message, id: `M${uploads.length}`, fromMe: true, status: 'sent' }, 201);
      }
      if (method !== 'GET') return json({ ok: true });
      if (url === '/api/me') return json(me);
      if (url === '/api/inboxes')
        return json({ inboxes: [apiInbox], maxInboxes: 1, canAdd: false });
      if (url === '/api/wa/status')
        return json({ state: 'open', me: null, qr: null, lastError: null });
      if (url.startsWith('/api/chats?')) return json({ chats: [chat], nextCursor: null });
      if (url.startsWith(`/api/chats/${encodeURIComponent(jid)}/messages`))
        return json({ messages: [message], nextBefore: null });
      if (url === `/api/chats/${encodeURIComponent(jid)}/notes`) return json([]);
      if (url === `/api/chats/${encodeURIComponent(jid)}`) return json({ chat, events: [] });
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
  return { uploads };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function drop(files: File[]) {
  const region = screen.getByRole('region', { name: 'Conversation with Bob Customer' });
  const dataTransfer = { types: ['Files'], files, dropEffect: '' };
  fireEvent.dragEnter(region, { dataTransfer });
  fireEvent.drop(region, { dataTransfer });
}

describe('Conversation file drop', () => {
  it('sends dropped files in order, quoting the replied message and captioning only the first', async () => {
    const { uploads } = setup(chatAt(Date.now() - HOUR));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('Hello');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByTestId('reply-bar')).toBeTruthy();
    const a = new File(['a'], 'invoice.pdf', { type: 'application/pdf' });
    const b = new File(['b'], 'map.pdf', { type: 'application/pdf' });
    drop([a, b]);
    expect(screen.getByTestId('attachment-tray').textContent).toContain('2 files to send');
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'As promised{Enter}');
    await waitFor(() => expect(uploads).toHaveLength(2));
    expect((uploads[0]!.get('file') as File).name).toBe('invoice.pdf');
    expect(uploads[0]!.get('caption')).toBe('As promised');
    expect(uploads[0]!.get('quotedId')).toBe('A1');
    expect((uploads[1]!.get('file') as File).name).toBe('map.pdf');
    expect(uploads[1]!.get('caption')).toBeNull();
    expect(uploads[1]!.get('quotedId')).toBeNull();
    expect(screen.queryByTestId('reply-bar')).toBeNull();
  });

  it('refuses a drop once the reply window has closed', async () => {
    const { uploads } = setup(chatAt(Date.now() - 25 * HOUR));
    await screen.findByTestId('window-closed');
    const region = screen.getByRole('region', { name: 'Conversation with Bob Customer' });
    fireEvent.dragEnter(region, { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.getByTestId('file-drop-overlay').textContent).toContain(
      'Files can’t be sent in this chat right now.',
    );
    drop([new File(['a'], 'a.pdf')]);
    expect(screen.queryByTestId('attachment-tray')).toBeNull();
    expect(uploads).toHaveLength(0);
  });
});

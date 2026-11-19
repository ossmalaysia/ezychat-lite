// Live translate inside a real conversation: the bubbles, the placeholder, and the checked send path.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chat, Message, User } from '@ezychat/shared';
import { InboxPage } from './InboxPage';

const jid = '60127020388@s.whatsapp.net';
const me = {
  id: 1,
  username: 'alice',
  displayName: 'Alice',
  role: 'agent',
  mustChangePassword: false,
  disabled: false,
  createdAt: 0,
  locale: null,
  translateLanguage: 'ms',
  sendWithoutPreview: false,
} as User;
const chat: Chat = {
  jid,
  inboxId: 1,
  waJid: jid,
  type: 'dm',
  name: 'Tan Wei Jie',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: Date.now(),
  lastMessagePreview: '你好',
  status: 'open',
  assignedTo: null,
  updatedAt: Date.now(),
  phone: '60127020388',
  lastInboundAt: null,
};
const incoming: Message = {
  id: 'A1',
  chatJid: jid,
  senderJid: jid,
  senderName: 'Tan',
  sentByUserId: null,
  type: 'text',
  body: '你好，Kopi O 粉多少钱？',
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

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let on: boolean;
let detected: string;
let sendWithoutPreview: boolean;
let draftAnswer: () => Response;
const sent: Record<string, unknown>[] = [];
const drafts: unknown[] = [];

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  on = true;
  detected = 'zh';
  sendWithoutPreview = false;
  sent.length = 0;
  drafts.length = 0;
  draftAnswer = () =>
    json({
      status: 'ok',
      translation: '价格是 RM42.00。',
      from: 'ms',
      protected: ['RM42.00'],
      draftId: 'd1',
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const chatUrl = `/api/chats/${encodeURIComponent(jid)}`;
      if (url === '/api/me') return json({ ...me, sendWithoutPreview });
      if (url === '/api/live-translate')
        return json({ enabled: true, dailyLimit: 200, connected: true, usedToday: 1 });
      if (url === `${chatUrl}/live-translate` && method === 'PUT') {
        if (typeof body.on === 'boolean') on = body.on;
        return json(state());
      }
      if (url === `${chatUrl}/live-translate`) return json(state());
      if (url === `${chatUrl}/translations`)
        return json({
          translations: {
            A1: { status: 'ok', text: 'Hello, how much is Kopi O powder?', from: 'zh' },
          },
        });
      if (url === `${chatUrl}/translate-draft`) {
        drafts.push(body);
        return draftAnswer();
      }
      if (method === 'POST' && url === `${chatUrl}/messages`) {
        sent.push(body);
        return json(
          { ...incoming, id: 'S1', fromMe: true, body: String(body.text), status: 'sent' },
          201,
        );
      }
      if (url === '/api/inboxes') return json({ error: { code: 'not_found', message: 'x' } }, 404);
      if (url === '/api/wa/status')
        return json({ state: 'open', me: null, qr: null, lastError: null });
      if (url.startsWith('/api/chats?')) return json({ chats: [chat], nextCursor: null });
      if (url.startsWith(`${chatUrl}/messages`))
        return json({ messages: [incoming], nextBefore: null });
      if (url === `${chatUrl}/notes`) return json([]);
      if (url === chatUrl) return json({ chat, events: [] });
      if (url === '/api/quick-replies') return json([]);
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const state = () => ({
  on,
  customerLanguage: null,
  detected,
  mixed: null,
  outgoingLanguage: null,
  outgoingDetected: null,
});

function open() {
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
}

const typeAndSend = async (text: string) => {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: /message/i }), `${text}{Enter}`);
  return user;
};

describe('Live translate in a conversation', () => {
  it('shows the translated bubble and tells the person what they type and what the customer gets', async () => {
    open();
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(await within(log).findByText('Hello, how much is Kopi O powder?')).toBeTruthy();
    expect(within(log).getByText('Translated from 中文')).toBeTruthy();
    expect(screen.getByTestId('translate-bar')).toBeTruthy();
    expect(
      await screen.findByPlaceholderText('You type Bahasa Melayu, the customer gets 中文'),
    ).toBeTruthy();
  });

  it('shows the real text and a hint while it is off, and only offers to turn it on', async () => {
    on = false;
    open();
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(await within(log).findByText('你好，Kopi O 粉多少钱？')).toBeTruthy();
    expect(screen.queryByTestId('translate-bar')).toBeNull();
    expect(await screen.findByText('Customer writes in 中文')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Translate$/ }));
    await screen.findByTestId('translate-bar');
  });

  it('sends nothing until the person presses Send in the preview, then sends the checked text with its draft', async () => {
    open();
    await typeAndSend('Harganya RM42.00.');
    const preview = await screen.findByTestId('translate-preview');
    expect(await within(preview).findByTestId('translate-preview-result')).toBeTruthy();
    expect(sent).toHaveLength(0);
    expect(drafts).toEqual([{ text: 'Harganya RM42.00.', target: 'zh' }]);
    await userEvent.click(within(preview).getByTestId('translate-send'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      text: '价格是 RM42.00。',
      translation: {
        draftId: 'd1',
        typedText: 'Harganya RM42.00.',
        typedLanguage: 'ms',
        edited: false,
      },
    });
    expect(screen.queryByTestId('translate-preview')).toBeNull();
    // my own bubble shows what I typed while the pending message is out
    expect((await screen.findAllByText('Harganya RM42.00.')).length).toBeGreaterThan(0);
  });

  it('sends the typed text as it is when "Send original instead" is chosen', async () => {
    open();
    await typeAndSend('Harganya RM42.00.');
    await userEvent.click(await screen.findByTestId('translate-send-original'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ text: 'Harganya RM42.00.', sentOriginal: true });
    expect(sent[0]).not.toHaveProperty('translation');
  });

  it('keeps editing when the preview is closed, and sends nothing', async () => {
    open();
    await typeAndSend('Harganya RM42.00.');
    const preview = await screen.findByTestId('translate-preview');
    await userEvent.click(within(preview).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByTestId('translate-preview')).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('refuses a translation that changed a price, and sends nothing', async () => {
    draftAnswer = () => json({ status: 'refused', item: 'RM42.00', became: 'RM24.00' });
    open();
    await typeAndSend('Harganya RM42.00.');
    expect(await screen.findByText('RM42.00 became RM24.00. Nothing was sent.')).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it('with Send without preview, translates and sends at once', async () => {
    sendWithoutPreview = true;
    open();
    await typeAndSend('Harganya RM42.00.');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ text: '价格是 RM42.00。' });
  });

  it('sends a normal message when the customer writes my language, and shows no preview', async () => {
    detected = 'ms';
    open();
    await screen.findByTestId('translate-bar');
    await typeAndSend('Terima kasih.');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ text: 'Terima kasih.', clientId: expect.any(String) });
    expect(drafts).toHaveLength(0);
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatTranslateState, LiveTranslateStatus, Message } from '@ezychat/shared';
import {
  ChatTranslateContext,
  chatStateKey,
  statusKey,
  type ChatTranslateContextValue,
} from '../api/live-translate';
import {
  BubbleText,
  SendPreview,
  TranslateBar,
  TranslateHeaderButton,
  TranslateHint,
} from './LiveTranslate';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: auth.user, isAdmin: false, isLoading: false, error: null }),
}));
const auth = vi.hoisted(() => ({
  user: { id: 1, role: 'agent', translateLanguage: 'ms' as string | null } as Record<
    string,
    unknown
  >,
}));

const JID = '60127020388@s.whatsapp.net';
let client: QueryClient;
let status: LiveTranslateStatus;
let chat: ChatTranslateState;
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
let draft: () => Response | Promise<Response>;
const calls: { url: string; body: unknown }[] = [];
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
  calls.push({ url, body });
  if (url.endsWith('/translate-draft')) return draft();
  if (url.endsWith('/live-translate') && init?.method === 'PUT') {
    chat = { ...chat, ...(body as Partial<ChatTranslateState>) };
    return json(chat);
  }
  if (url.endsWith('/live-translate')) return json(chat);
  return json({});
});

const okDraft = (over: Record<string, unknown> = {}) =>
  json({
    status: 'ok',
    translation: '好的，总共 RM1,260.00。',
    from: 'ms',
    protected: ['RM1,260.00'],
    draftId: 'd1',
    ...over,
  });

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  status = { enabled: true, dailyLimit: 200, connected: true, usedToday: 3 };
  chat = {
    on: true,
    customerLanguage: null,
    detected: 'zh',
    mixed: null,
    outgoingLanguage: null,
    outgoingDetected: null,
  };
  auth.user = { id: 1, role: 'agent', translateLanguage: 'ms' };
  draft = () => okDraft();
  calls.length = 0;
  fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
  client.setQueryData(statusKey, status);
  client.setQueryData(chatStateKey(JID), chat);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={client}>{node}</QueryClientProvider>
);

const msg = (over: Partial<Message>): Message =>
  ({
    id: 'm1',
    chatJid: JID,
    senderJid: JID,
    senderName: 'Tan',
    fromMe: false,
    sentByUserId: null,
    type: 'text',
    body: '你好',
    mediaUrl: null,
    mediaMime: null,
    mediaName: null,
    mediaStatus: 'none',
    quotedId: null,
    status: 'delivered',
    error: null,
    timestamp: 1,
    clientId: null,
    reactions: [],
    ...over,
  }) as Message;

function bubble(m: Message, ctx: Partial<ChatTranslateContextValue> = {}) {
  const value: ChatTranslateContextValue = {
    active: true,
    my: 'ms',
    showOriginals: false,
    translations: {},
    pending: false,
    retry: vi.fn(),
    ...ctx,
  };
  render(
    wrap(
      <ChatTranslateContext.Provider value={value}>
        <BubbleText m={m} render={(t) => t} />
      </ChatTranslateContext.Provider>,
    ),
  );
  return value;
}

describe('BubbleText', () => {
  it('shows a plain message as it is without the chat context', () => {
    render(wrap(<BubbleText m={msg({})} render={(t) => t} />));
    expect(screen.getByText('你好')).toBeTruthy();
  });

  it('shows the translation, then the original in the same bubble', async () => {
    bubble(msg({}), { translations: { m1: { kind: 'translated', text: 'Hello', from: 'zh' } } });
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Translated from 中文')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show original' }));
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.getByText('Original')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Original')).toBeNull();
  });

  it('opens every original while Show originals is on', () => {
    bubble(msg({}), {
      showOriginals: true,
      translations: { m1: { kind: 'translated', text: 'Hello', from: 'zh' } },
    });
    expect(screen.getByText('Original')).toBeTruthy();
  });

  it('shows the real text when Live translate is off', () => {
    bubble(msg({}), {
      active: false,
      translations: { m1: { kind: 'translated', text: 'Hello', from: 'zh' } },
    });
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.queryByText('Hello')).toBeNull();
  });

  it('reads "Sent in" on our own reply without a typed record', () => {
    bubble(msg({ fromMe: true, body: '好的' }), {
      translations: { m1: { kind: 'translated', text: 'Baik', from: 'zh' } },
    });
    expect(screen.getByText('Sent in 中文')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show sent text' })).toBeTruthy();
  });

  it('shows what the writer typed, with the sent text one tap away', async () => {
    bubble(
      msg({
        fromMe: true,
        body: '好的',
        typed: { typedText: 'Baik', typedLanguage: 'ms', sentLanguage: 'zh', edited: false },
      }),
    );
    expect(screen.getByText('Baik')).toBeTruthy();
    expect(screen.getByText('Sent in 中文')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show sent text' }));
    expect(screen.getByText('好的')).toBeTruthy();
  });

  it('shows the sent text to everyone else, with what was typed one tap away', async () => {
    bubble(
      msg({
        fromMe: true,
        body: '好的',
        typed: { typedText: 'Baik', typedLanguage: 'ms', sentLanguage: 'zh', edited: true },
      }),
      { active: false },
    );
    expect(screen.getByText('好的')).toBeTruthy();
    expect(screen.getByText('Written in Bahasa Melayu')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show what was typed' }));
    expect(screen.getByText('What was typed (translation edited before sending)')).toBeTruthy();
    expect(screen.getByText('Baik')).toBeTruthy();
  });

  it('marks "Send original instead" for whoever has it on', () => {
    bubble(msg({ fromMe: true, body: 'Baik', sentOriginal: true }));
    expect(screen.getByText('Sent without translation')).toBeTruthy();
  });

  it('keeps the original with the reason when a translation failed, and retries only when asked', async () => {
    const ctx = bubble(msg({}), { translations: { m1: { kind: 'failed', code: 'error' } } });
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.getByText('Could not translate')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ctx.retry).toHaveBeenCalledOnce();
  });

  it.each([
    ['unsafe', 'Could not translate safely'],
    ['limit', 'Not translated: daily limit used'],
    ['ai', 'Not translated: Live translate needs AI'],
    ['offline', 'Not translated: no connection'],
  ] as const)('says why %s was not translated', (code, label) => {
    bubble(msg({}), { translations: { m1: { kind: 'failed', code } } });
    expect(screen.getByText(label)).toBeTruthy();
    // only a temporary failure offers Try again
    expect(!!screen.queryByRole('button', { name: 'Try again' })).toBe(code === 'offline');
  });

  it('shows the original and "Translating…" until a new message is translated', () => {
    bubble(msg({}), { pending: true });
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Translating');
  });
});

describe('TranslateHeaderButton', () => {
  it('turns Live translate on for me in this chat', async () => {
    chat = { ...chat, on: false };
    client.setQueryData(chatStateKey(JID), chat);
    render(wrap(<TranslateHeaderButton jid={JID} />));
    const button = screen.getByTestId('translate-toggle');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(button);
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { on?: boolean })?.on === true)).toBe(true),
    );
  });

  it('is hidden everywhere while an admin has it off', () => {
    client.setQueryData(statusKey, { ...status, enabled: false });
    render(wrap(<TranslateHeaderButton jid={JID} />));
    expect(screen.queryByTestId('translate-toggle')).toBeNull();
  });
});

describe('TranslateBar', () => {
  const bar = (isGroup = false) =>
    render(
      wrap(
        <TranslateBar
          jid={JID}
          isGroup={isGroup}
          showOriginals={false}
          onShowOriginals={vi.fn()}
        />,
      ),
    );

  it('names the languages and says the language was detected', () => {
    bar();
    expect(screen.getByText('中文 → Bahasa Melayu')).toBeTruthy();
    expect(screen.getByText('detected')).toBeTruthy();
  });

  it('shows "中文 + English" when the customer mixes languages', () => {
    client.setQueryData(chatStateKey(JID), { ...chat, mixed: 'en' });
    bar();
    expect(screen.getByText('中文 + English → Bahasa Melayu')).toBeTruthy();
  });

  it('says nothing needs translating when the customer writes my language', () => {
    client.setQueryData(chatStateKey(JID), { ...chat, detected: 'ms' });
    bar();
    expect(screen.getByText(/Nothing to translate/)).toBeTruthy();
  });

  it('says so while the customer language is not known yet', () => {
    client.setQueryData(chatStateKey(JID), { ...chat, detected: null });
    bar();
    expect(screen.getByText(/We'll know the customer's language/)).toBeTruthy();
  });

  it.each([
    [{ connected: false }, /needs AI/],
    [{ usedToday: 200 }, /Daily limit used/],
  ])('warns when %j', (over, text) => {
    client.setQueryData(statusKey, { ...status, ...over });
    bar();
    expect(screen.getByRole('status').textContent).toMatch(text);
  });

  it('shows each group member from their own language and the one outgoing language', () => {
    client.setQueryData(chatStateKey(JID), { ...chat, outgoingDetected: 'zh' });
    bar(true);
    expect(screen.getByText('Members → Bahasa Melayu · replies in 中文')).toBeTruthy();
  });

  it('is hidden while my switch is off', () => {
    client.setQueryData(chatStateKey(JID), { ...chat, on: false });
    bar();
    expect(screen.queryByTestId('translate-bar')).toBeNull();
  });

  it('shares a chosen customer language with the team, and turns Live translate off', async () => {
    bar();
    await userEvent.click(screen.getByTestId('translate-languages'));
    expect(screen.getByTestId('translate-usage').textContent).toBe('Today: 3 of 200 translations');
    await userEvent.click(screen.getByTestId('translate-off'));
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { on?: boolean })?.on === false)).toBe(true),
    );
  });
});

describe('TranslateHint', () => {
  it('offers Translate when the customer writes another language, and only offers', async () => {
    client.setQueryData(chatStateKey(JID), { ...chat, on: false });
    render(wrap(<TranslateHint jid={JID} isGroup={false} />));
    expect(screen.getByText('Customer writes in 中文')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { on?: boolean })?.on === true)).toBe(true),
    );
  });

  it('can be dismissed', async () => {
    client.setQueryData(chatStateKey(JID), { ...chat, on: false });
    render(wrap(<TranslateHint jid={JID} isGroup={false} />));
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('translate-hint')).toBeNull();
  });

  it.each([
    ['on already', { on: true }],
    ['the customer writes my language', { on: false, detected: 'ms' }],
    ['no language known', { on: false, detected: null }],
  ])('is not shown when %s', (_name, over) => {
    client.setQueryData(chatStateKey(JID), { ...chat, ...over });
    render(wrap(<TranslateHint jid={JID} isGroup={false} />));
    expect(screen.queryByTestId('translate-hint')).toBeNull();
  });

  it('is not shown in a group', () => {
    client.setQueryData(chatStateKey(JID), { ...chat, on: false });
    render(wrap(<TranslateHint jid={JID} isGroup />));
    expect(screen.queryByTestId('translate-hint')).toBeNull();
  });
});

describe('SendPreview', () => {
  const props = () => ({
    jid: JID,
    typed: 'Baik, jumlahnya RM1,260.00.',
    my: 'ms' as const,
    customer: 'zh' as const,
    dailyLimit: 200,
    autoSend: false,
    onSend: vi.fn(),
    onSendOriginal: vi.fn(),
    onDiscard: vi.fn(),
  });

  it('shows what the customer will get and the items kept unchanged, and sends nothing by itself', async () => {
    const p = props();
    render(wrap(<SendPreview {...p} />));
    expect(await screen.findByTestId('translate-preview-result')).toBeTruthy();
    expect(screen.getByText('Customer will get · 中文', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('RM1,260.00')).toBeTruthy();
    expect(screen.getByText('You wrote (Bahasa Melayu)')).toBeTruthy();
    expect(p.onSend).not.toHaveBeenCalled();
    expect(calls[0]?.body).toEqual({ text: p.typed, target: 'zh' });
  });

  it('sends the checked text with its draft', async () => {
    const p = props();
    render(wrap(<SendPreview {...p} />));
    await userEvent.click(await screen.findByTestId('translate-send'));
    expect(p.onSend).toHaveBeenCalledWith({
      text: '好的，总共 RM1,260.00。',
      typedText: p.typed,
      edited: false,
      draftId: 'd1',
    });
  });

  it('marks an edited translation and sends the edit', async () => {
    const p = props();
    render(wrap(<SendPreview {...p} />));
    await userEvent.click(await screen.findByTestId('translate-edit'));
    const box = screen.getByTestId('translate-preview-text');
    await userEvent.clear(box);
    await userEvent.type(box, '好的 RM1,260.00');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('edited')).toBeTruthy();
    await userEvent.click(screen.getByTestId('translate-send'));
    expect(p.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: '好的 RM1,260.00', edited: true, draftId: 'd1' }),
    );
  });

  it('translates again after the typed text is changed', async () => {
    const p = props();
    render(wrap(<SendPreview {...p} />));
    await screen.findByTestId('translate-preview-result');
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    const box = screen.getByLabelText('You wrote (Bahasa Melayu)');
    await userEvent.clear(box);
    await userEvent.type(box, 'Terima kasih');
    await userEvent.click(screen.getByRole('button', { name: 'Translate again' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/translate-draft'))).toHaveLength(2),
    );
    expect(calls[1]?.body).toEqual({ text: 'Terima kasih', target: 'zh' });
  });

  it('sends the original instead, and Esc keeps editing', async () => {
    const p = props();
    render(wrap(<SendPreview {...p} />));
    await screen.findByTestId('translate-preview-result');
    await userEvent.click(screen.getByTestId('translate-send-original'));
    expect(p.onSendOriginal).toHaveBeenCalledWith(p.typed);
    await userEvent.keyboard('{Escape}');
    expect(p.onDiscard).toHaveBeenCalled();
  });

  it('sends with Ctrl+Enter', async () => {
    const p = props();
    render(wrap(<SendPreview {...p} />));
    await screen.findByTestId('translate-preview-result');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(p.onSend).toHaveBeenCalledOnce();
  });

  it('refuses a translation that changed a number and sends nothing', async () => {
    draft = () => json({ status: 'refused', item: 'RM1,260.00', became: 'RM4,260.00' });
    const p = props();
    render(wrap(<SendPreview {...p} />));
    expect(await screen.findByText('RM1,260.00 became RM4,260.00. Nothing was sent.')).toBeTruthy();
    expect((screen.getByTestId('translate-send') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByTestId('translate-send-original')).toBeTruthy();
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'translate_limit', 'Daily limit used (200 translations). Nothing was sent.'],
    [
      503,
      'ai_unavailable',
      'Live translate needs AI. Ask an admin to connect AI in Settings → AI. Nothing was sent.',
    ],
    [409, 'translate_off', 'An admin turned Live translate off. Nothing was sent.'],
    [500, 'boom', 'Could not translate. Nothing was sent.'],
  ])('says why nothing was sent (%i %s)', async (code, error, text) => {
    draft = () => json({ error: { code: error, message: 'x' } }, code);
    const p = props();
    render(wrap(<SendPreview {...p} />));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(p.onSend).not.toHaveBeenCalled();
    expect(p.onSendOriginal).not.toHaveBeenCalled();
  });

  it('says there is no connection when the request cannot leave', async () => {
    draft = () => {
      throw new TypeError('Failed to fetch');
    };
    render(wrap(<SendPreview {...props()} />));
    expect(
      await screen.findByText('Cannot translate. No connection. Nothing was sent.'),
    ).toBeTruthy();
  });

  it('with Send without preview, sends at once and still stops on a problem', async () => {
    const p = { ...props(), autoSend: true };
    render(wrap(<SendPreview {...p} />));
    await waitFor(() => expect(p.onSend).toHaveBeenCalledOnce());
    expect(p.onSend.mock.calls[0]?.[0]).toMatchObject({ draftId: 'd1', edited: false });
    cleanup();
    draft = () => json({ status: 'refused', item: 'RM1', became: 'RM2' });
    const q = { ...props(), autoSend: true };
    render(wrap(<SendPreview {...q} />));
    expect(await screen.findByText('RM1 became RM2. Nothing was sent.')).toBeTruthy();
    expect(q.onSend).not.toHaveBeenCalled();
  });

  it('tells the person it is translating while it waits', async () => {
    let release: (r: Response) => void = () => undefined;
    draft = () => new Promise<Response>((r) => (release = r));
    render(wrap(<SendPreview {...props()} />));
    expect(screen.getByRole('status').textContent).toContain('Translating into 中文');
    await act(async () => release(okDraft()));
    await within(screen.getByTestId('translate-preview')).findByTestId('translate-preview-result');
  });
});

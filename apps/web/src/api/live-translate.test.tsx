import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Message } from '@ezychat/shared';
import {
  chatStateKey,
  customerLanguageOf,
  needsTranslation,
  outgoingLanguageOf,
  translationsKey,
  useCachedLastTranslations,
  useChatTranslations,
  useMyTranslate,
  useShowOriginals,
} from './live-translate';
import type { ChatTranslateState, TranslatableMessage } from './live-translate-types';
import { qk } from './queries';

const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: auth.user }) }));
const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('@/i18n/locale-store', () => ({ useLocale: () => locale.value }));

const JID = '60127020388@s.whatsapp.net';
let client: QueryClient;
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
let answer: (ids: string[]) => Response | Promise<Response>;
const asked: { ids: string[]; target: string }[] = [];
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith('/translations')) {
    const body = JSON.parse(String(init?.body)) as { messageIds: string[]; target: string };
    asked.push({ ids: body.messageIds, target: body.target });
    return answer(body.messageIds);
  }
  return json({});
});

const m = (id: string, over: Partial<TranslatableMessage> = {}): TranslatableMessage =>
  ({
    id,
    chatJid: JID,
    fromMe: false,
    type: 'text',
    body: `text ${id}`,
    ...over,
  }) as Message as TranslatableMessage;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  auth.user = { id: 1, translateLanguage: null };
  locale.value = 'en';
  asked.length = 0;
  answer = (ids) =>
    json({
      translations: Object.fromEntries(
        ids.map((id) => [id, { status: 'ok', text: `T ${id}`, from: 'zh' }]),
      ),
    });
  fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('needsTranslation', () => {
  it('skips what has no text, a local pending bubble, a deleted or system row, and our own typed replies', () => {
    expect(needsTranslation(m('a'))).toBe(true);
    expect(needsTranslation(m('a', { body: null }))).toBe(false);
    expect(needsTranslation(m('local-a'))).toBe(false);
    expect(needsTranslation(m('a', { deletedAt: 5 }))).toBe(false);
    expect(needsTranslation(m('a', { type: 'system' }))).toBe(false);
    const typed = {
      typedText: 'x',
      typedLanguage: 'ms',
      sentLanguage: 'zh',
      edited: false,
    } as const;
    expect(needsTranslation(m('a', { fromMe: true, typed }))).toBe(false);
    // our reply without a typed record (the AI agent's, the phone's) is translated for "Sent in …"
    expect(needsTranslation(m('a', { fromMe: true }))).toBe(true);
  });
});

describe('languages', () => {
  const state = (over: Partial<ChatTranslateState>): ChatTranslateState => ({
    on: true,
    customerLanguage: null,
    detected: null,
    mixed: null,
    outgoingLanguage: null,
    outgoingDetected: null,
    ...over,
  });
  it('prefers the language a teammate chose over the detected one', () => {
    expect(customerLanguageOf(state({ detected: 'zh' }))).toBe('zh');
    expect(customerLanguageOf(state({ detected: 'zh', customerLanguage: 'ta' }))).toBe('ta');
    expect(customerLanguageOf(undefined)).toBeNull();
  });
  it('uses the group language in a group and the customer language in a direct chat', () => {
    const s = state({ detected: 'zh', outgoingDetected: 'en' });
    expect(outgoingLanguageOf(s, false)).toBe('zh');
    expect(outgoingLanguageOf(s, true)).toBe('en');
    expect(
      outgoingLanguageOf(state({ outgoingLanguage: 'ms', outgoingDetected: 'en' }), true),
    ).toBe('ms');
  });
});

describe('useMyTranslate', () => {
  it.each([
    ['en', 'en'],
    ['ms', 'ms'],
    ['zh-CN', 'zh'],
  ])('follows the app language (%s) until I pick one', (app, expected) => {
    locale.value = app;
    const { result } = renderHook(() => useMyTranslate(), { wrapper });
    expect(result.current).toMatchObject({ myLanguage: expected, myLanguageSet: false });
  });
  it('uses my choice and Send without preview from /api/me', () => {
    auth.user = { id: 1, translateLanguage: 'ta', sendWithoutPreview: true };
    const { result } = renderHook(() => useMyTranslate(), { wrapper });
    expect(result.current).toEqual({
      myLanguage: 'ta',
      myLanguageSet: true,
      sendWithoutPreview: true,
    });
  });
});

describe('useChatTranslations', () => {
  it('asks nothing while Live translate is off', async () => {
    renderHook(() => useChatTranslations(JID, [m('a')], 'ms', false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveLength(0);
  });

  it('asks for the loaded messages once, and keeps the answers', async () => {
    const messages = [m('a'), m('b'), m('c', { body: null })];
    const { result, rerender } = renderHook(() => useChatTranslations(JID, messages, 'ms', true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.translations.a).toBeTruthy());
    expect(asked).toEqual([{ ids: ['a', 'b'], target: 'ms' }]);
    expect(result.current.translations.a).toEqual({ kind: 'translated', text: 'T a', from: 'zh' });
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveLength(1);
  });

  it('asks again for a message whose text was edited, and for new ones only', async () => {
    let messages = [m('a')];
    const { result, rerender } = renderHook(() => useChatTranslations(JID, messages, 'ms', true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.translations.a).toBeTruthy());
    messages = [m('a', { body: 'edited' }), m('b')];
    rerender();
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]?.ids).toEqual(['a', 'b']);
  });

  it('asks for at most 50 messages, the newest', async () => {
    const messages = Array.from({ length: 60 }, (_, i) => m(`m${i}`));
    renderHook(() => useChatTranslations(JID, messages, 'ms', true), { wrapper });
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]?.ids).toHaveLength(50);
    expect(asked[0]?.ids[0]).toBe('m10');
  });

  it('shows nothing for a message already in my language', async () => {
    answer = () => json({ translations: { a: { status: 'same_language' } } });
    const { result } = renderHook(() => useChatTranslations(JID, [m('a')], 'ms', true), {
      wrapper,
    });
    await waitFor(() => expect(asked).toHaveLength(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.translations.a).toBeNull();
  });

  it.each([
    ['unsafe', { status: 'unsafe', from: 'zh' }, { kind: 'failed', code: 'unsafe', from: 'zh' }],
    ['limit', { status: 'limit' }, { kind: 'failed', code: 'limit' }],
    ['ai_unavailable', { status: 'ai_unavailable' }, { kind: 'failed', code: 'ai' }],
    ['failed', { status: 'failed' }, { kind: 'failed', code: 'error' }],
  ])('turns the server answer %s into the bubble state', async (_n, status, bubble) => {
    answer = () => json({ translations: { a: status } });
    const { result } = renderHook(() => useChatTranslations(JID, [m('a')], 'ms', true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.translations.a).toEqual(bubble));
  });

  it('marks every asked message offline when there is no connection, and retries only on request', async () => {
    answer = () => {
      throw new TypeError('Failed to fetch');
    };
    const { result } = renderHook(() => useChatTranslations(JID, [m('a')], 'ms', true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.translations.a).toEqual({ kind: 'failed', code: 'offline' }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(asked).toHaveLength(1); // never by itself
    answer = (ids) =>
      json({ translations: { [ids[0]!]: { status: 'ok', text: 'T', from: 'zh' } } });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.translations.a?.kind).toBe('translated'));
    expect(asked).toHaveLength(2);
  });

  it('marks a model error as failed, and a server error too', async () => {
    answer = () => json({ error: { code: 'x', message: 'x' } }, 500);
    const { result } = renderHook(() => useChatTranslations(JID, [m('a')], 'ms', true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.translations.a).toEqual({ kind: 'failed', code: 'error' }),
    );
  });
});

describe('useCachedLastTranslations', () => {
  const chats = [
    { jid: JID, lastMessagePreview: '你好，我想订…' },
    { jid: 'other@s.whatsapp.net', lastMessagePreview: '你好，我想订…' },
  ];
  const seed = (on: boolean) => {
    client.setQueryData(chatStateKey(JID), { on } as ChatTranslateState);
    client.setQueryData(translationsKey(JID, 'en'), {
      a: {
        body: '你好，我想订两盒咖啡粉',
        tr: { status: 'ok', text: 'Hello, I want to order', from: 'zh' },
      },
    });
  };
  it('gives the cached translation of a chat whose switch is on, and never calls the AI', () => {
    seed(true);
    const { result } = renderHook(() => useCachedLastTranslations(chats), { wrapper });
    expect(result.current.get(JID)).toBe('Hello, I want to order');
    expect(result.current.has('other@s.whatsapp.net')).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('gives nothing while the switch is off, and follows my language choice', () => {
    seed(false);
    const { result } = renderHook(() => useCachedLastTranslations(chats), { wrapper });
    expect(result.current.size).toBe(0);
    seed(true);
    client.setQueryData(qk.me, { id: 1, translateLanguage: 'ms' });
    const again = renderHook(() => useCachedLastTranslations(chats), { wrapper });
    expect(again.result.current.size).toBe(0); // nothing cached in Bahasa Melayu
  });
  it('updates when a translation arrives', async () => {
    const { result } = renderHook(() => useCachedLastTranslations(chats), { wrapper });
    expect(result.current.size).toBe(0);
    act(() => seed(true));
    await waitFor(() => expect(result.current.get(JID)).toBe('Hello, I want to order'));
  });
  it('works without a query client', () => {
    const { result } = renderHook(() => useCachedLastTranslations(chats));
    expect(result.current.size).toBe(0);
  });
});

describe('useShowOriginals', () => {
  it('is per chat for this tab', () => {
    const { result, unmount } = renderHook(() => useShowOriginals(JID));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    unmount();
    expect(renderHook(() => useShowOriginals(JID)).result.current[0]).toBe(true);
    expect(renderHook(() => useShowOriginals('other')).result.current[0]).toBe(false);
    sessionStorage.clear();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type default as React } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@wa-team-inbox/shared';
import {
  patchMessageInCache,
  qk,
  upsertMessageInCache,
  useChats,
  useCustomerProfile,
  useCustomerTags,
  useSaveCustomerProfile,
  type MessagesData,
} from './queries';

const JID = '60123456789@s.whatsapp.net';

function msg(fields: Partial<Message>): Message {
  return {
    id: 'm1',
    chatJid: JID,
    senderJid: null,
    senderName: null,
    fromMe: true,
    sentByUserId: 1,
    type: 'text',
    body: 'Hello!',
    mediaUrl: null,
    mediaMime: null,
    mediaName: null,
    mediaStatus: 'none',
    quotedId: null,
    status: 'pending',
    error: null,
    timestamp: 1000,
    clientId: 'c1',
    ...fields,
  };
}

function seed(qc: QueryClient, messages: Message[]) {
  qc.setQueryData<MessagesData>(qk.messages(JID), {
    pages: [{ messages, nextBefore: null }],
    pageParams: [null],
  });
}

function cached(qc: QueryClient): Message[] {
  return qc.getQueryData<MessagesData>(qk.messages(JID))!.pages.flatMap((p) => p.messages);
}

describe('message cache', () => {
  it('a late POST response does not regress a status already advanced by the socket', () => {
    const qc = new QueryClient();
    seed(qc, [msg({ id: 'local-c1' })]);
    // Socket: sent (renamed to WA id), then delivered — before the POST response arrives.
    patchMessageInCache(
      qc,
      JID,
      { id: 'srv-1', clientId: 'c1' },
      { status: 'sent', error: null, id: 'WA-1' },
    );
    patchMessageInCache(
      qc,
      JID,
      { id: 'WA-1', clientId: 'c1' },
      { status: 'delivered', error: null },
    );
    // POST response: still the pending server row.
    upsertMessageInCache(qc, msg({ id: 'srv-1', status: 'pending' }));

    const all = cached(qc);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'WA-1', status: 'delivered', clientId: 'c1' });
  });

  it('a newer status from the server replaces the cached one', () => {
    const qc = new QueryClient();
    seed(qc, [msg({ id: 'local-c1' })]);
    upsertMessageInCache(qc, msg({ id: 'WA-1', status: 'sent' }));
    expect(cached(qc)[0]).toMatchObject({ id: 'WA-1', status: 'sent' });
  });

  it('a retry (failed → pending) is applied', () => {
    const qc = new QueryClient();
    seed(qc, [msg({ id: 'srv-1', status: 'failed', error: 'x' })]);
    upsertMessageInCache(qc, msg({ id: 'srv-1', status: 'pending', error: null }));
    expect(cached(qc)[0]).toMatchObject({ status: 'pending', error: null });
  });

  it('renaming a sent media message also moves its mediaUrl to the new id', () => {
    const qc = new QueryClient();
    seed(qc, [msg({ id: 'local-c1', type: 'document', mediaUrl: '/api/media/local-c1' })]);
    patchMessageInCache(
      qc,
      JID,
      { id: 'local-c1', clientId: 'c1' },
      { status: 'sent', error: null, id: 'WA/1' },
    );
    expect(cached(qc)[0]).toMatchObject({ id: 'WA/1', mediaUrl: '/api/media/WA%2F1' });
    // A late POST response with the stale local URL must not bring it back.
    upsertMessageInCache(
      qc,
      msg({ id: 'local-c1', type: 'document', status: 'pending', mediaUrl: '/api/media/local-c1' }),
    );
    expect(cached(qc)[0]).toMatchObject({ id: 'WA/1', mediaUrl: '/api/media/WA%2F1' });
  });

  it('a text message rename leaves mediaUrl null', () => {
    const qc = new QueryClient();
    seed(qc, [msg({ id: 'local-c1' })]);
    patchMessageInCache(
      qc,
      JID,
      { id: 'local-c1', clientId: 'c1' },
      { status: 'sent', error: null, id: 'WA-1' },
    );
    expect(cached(qc)[0]!.mediaUrl).toBeNull();
  });
});

describe('customer profile queries', () => {
  const FARAH = '601@s.whatsapp.net';
  const response = {
    profile: {
      name: 'Farah Aziz',
      company: null,
      email: null,
      otherPhone: null,
      address: null,
      tags: ['VIP'],
      updatedAt: 1,
      updatedBy: 1,
    },
    whatsappName: 'Farah',
  };

  function mockFetchJson(data: unknown) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${String(init.body)}` : ''}`);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    return calls;
  }

  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    return { queryClient, wrapper };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the tag filter in the chat list query', async () => {
    const calls = mockFetchJson({ chats: [], nextCursor: null });
    const { wrapper } = setup();
    renderHook(() => useChats({ assigned: 'any', tag: 'VIP' }), { wrapper });
    await waitFor(() => expect(calls[0]).toContain('tag=VIP'));
  });

  it('loads a customer profile only when a chat is given', async () => {
    const calls = mockFetchJson(response);
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ jid }: { jid: string | null }) => useCustomerProfile(jid),
      { wrapper, initialProps: { jid: null as string | null } },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(calls).toEqual([]);
    rerender({ jid: FARAH });
    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(calls).toEqual(['GET /api/chats/601%40s.whatsapp.net/profile']);
  });

  it('saves a customer profile and stores the response in the cache', async () => {
    const calls = mockFetchJson(response);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveCustomerProfile(FARAH), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        name: 'Farah Aziz',
        company: '',
        email: '',
        otherPhone: '',
        address: '',
        tags: ['VIP'],
      }),
    );
    expect(calls[0]).toMatch(/^PUT \/api\/chats\/601%40s\.whatsapp\.net\/profile /);
    expect(queryClient.getQueryData(qk.customerProfile(FARAH))).toEqual(response);
  });

  it('loads tag suggestions for a search', async () => {
    const calls = mockFetchJson({ tags: ['VIP', 'Vegan'] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCustomerTags('v i'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(['VIP', 'Vegan']));
    expect(calls).toEqual(['GET /api/customer-tags?q=v%20i']);
  });
});

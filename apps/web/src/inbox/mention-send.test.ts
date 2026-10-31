import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type default as React } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INBOX_CAPABILITIES,
  type Inbox,
  type InboxListResponse,
  type Message,
} from '@ezychat/shared';
import { qk, useSendText, type MessagesData } from '../api/queries';
import { useInboxCanTag } from './reply-window';

const GROUP = '120363000000001@g.us';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

afterEach(() => vi.unstubAllGlobals());

describe('sending tags', () => {
  it('posts the mentions with the @<number> text and shows @Name in the pending bubble', async () => {
    const bodies: unknown[] = [];
    let release!: () => void;
    const answered = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        await answered;
        return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
      }),
    );
    const { qc, wrapper } = wrap();
    qc.setQueryData<MessagesData>(qk.messages(GROUP), {
      pages: [{ messages: [], nextBefore: null }],
      pageParams: [null],
    });
    const { result } = renderHook(() => useSendText(GROUP), { wrapper });
    act(() =>
      result.current.mutate({
        text: 'Hi @60123110021',
        clientId: 'c1',
        mentions: ['60123110021@s.whatsapp.net'],
        shown: 'Hi @Farah Aziz',
      }),
    );
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      text: 'Hi @60123110021',
      clientId: 'c1',
      mentions: ['60123110021@s.whatsapp.net'],
    });
    const pending = qc
      .getQueryData<MessagesData>(qk.messages(GROUP))!
      .pages.flatMap((p) => p.messages) as Message[];
    expect(pending.map((m) => m.body)).toEqual(['Hi @Farah Aziz']);
    release();

    act(() => result.current.mutate({ text: 'Plain', clientId: 'c2' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ text: 'Plain', clientId: 'c2' });
  });
});

describe('useInboxCanTag', () => {
  const inbox = (id: number, capabilities: Inbox['capabilities'] | undefined): Inbox =>
    ({
      id,
      name: `Inbox ${id}`,
      tone: 'primary',
      number: null,
      removed: false,
      aiAgentId: null,
      type: 'linked_phone',
      status: { state: 'open', me: null, qr: null, lastError: null },
      ...(capabilities ? { capabilities } : {}),
    }) as Inbox;

  it('is true only for an inbox whose connection says it tags (an older server: linked phone)', async () => {
    const { mentions: _m, ...noMentions } = DEFAULT_INBOX_CAPABILITIES;
    const list: InboxListResponse = {
      inboxes: [
        inbox(1, DEFAULT_INBOX_CAPABILITIES),
        inbox(2, { ...noMentions, replyWindowHours: 24, groups: true }),
        inbox(3, undefined),
      ],
      maxInboxes: 3,
      canAdd: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(list), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useInboxCanTag(), { wrapper });
    expect(result.current(1)).toBe(false);
    await waitFor(() => expect(result.current(1)).toBe(true));
    expect(result.current(2)).toBe(false);
    expect(result.current(3)).toBe(true);
    expect(result.current(9)).toBe(false);
  });
});

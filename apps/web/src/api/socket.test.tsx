import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatAvatar } from '../inbox/ChatAvatar';
import { RealtimeProvider } from './socket';
import type * as Queries from './queries';

const socket = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) =>
      listeners.set(event, callback),
    ),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(() => listeners.clear()),
    emit: vi.fn(),
  };
});
vi.mock('socket.io-client', () => ({ io: () => socket }));
vi.mock('./queries', async (importOriginal) => {
  const original = await importOriginal<typeof Queries>();
  return {
    ...original,
    useMe: () => ({ data: { id: 1, disabled: false, mustChangePassword: false } }),
    useWaStatus: () =>
      useQuery({
        queryKey: original.qk.wa,
        queryFn: () => Promise.resolve({ state: 'connecting' }),
        staleTime: Infinity,
      }),
  };
});

afterEach(() => {
  cleanup();
  socket.listeners.clear();
});

it('restores profile requests when WhatsApp opens after the inbox, and after a later reconnect', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <ChatAvatar name="Test Customer" src="/api/chats/test%40s.whatsapp.net/avatar" />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(socket.listeners.has('connect')).toBe(true));
  await act(async () => socket.listeners.get('connect')!());
  expect(view.container.querySelector('img')).toBeNull();
  act(() => socket.listeners.get('wa:status')!({ state: 'open' }));
  await waitFor(() => expect(view.container.querySelector('img')).toBeTruthy());
  const first = view.container.querySelector('img')!;
  fireEvent.error(first);
  expect(view.container.querySelector('img')).toBeNull();
  act(() => socket.listeners.get('wa:status')!({ state: 'connecting' }));
  await waitFor(() => expect(view.container.querySelector('img')).toBeNull());
  act(() => socket.listeners.get('wa:status')!({ state: 'open' }));
  await waitFor(() => expect(view.container.querySelector('img')).toBeTruthy());
  expect(view.container.querySelector('img')).not.toBe(first);
  fireEvent.load(view.container.querySelector('img')!);
  expect(view.container.textContent).not.toContain('TC');
  qc.clear();
});

it('fetches changes missed before the first socket connection and during a reconnect', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let serverChat = 'Before the connection';
  function Chats() {
    const { data } = useQuery({
      queryKey: ['chats'],
      queryFn: async () => serverChat,
      staleTime: Infinity,
    });
    return <span>{data}</span>;
  }
  render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <Chats />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Before the connection');
  serverChat = 'Arrived before joining the socket';
  await act(async () => socket.listeners.get('connect')!());
  await screen.findByText(serverChat);
  act(() => socket.listeners.get('disconnect')!());
  serverChat = 'Arrived while offline';
  await act(async () => socket.listeners.get('connect')!());
  await screen.findByText(serverChat);
  qc.clear();
});

it('coalesces a bulk chat update into one list/count refresh and replaces stale in-flight responses', async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const listKey = ['chats', { assigned: 'any' }];
  qc.setQueryData(listKey, { pages: [{ chats: [], nextCursor: null }], pageParams: [null] });
  qc.setQueryData(['open-chat-count'], { openCount: 205 });
  let serverCount = 205;
  const aborted = vi.fn();
  const queryCount = vi.fn(({ signal }: { signal: AbortSignal }) => {
    const snapshot = serverCount;
    return new Promise<{ openCount: number }>((resolve, reject) => {
      const timer = setTimeout(() => resolve({ openCount: snapshot }), 200);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          aborted();
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  });
  const queryList = vi.fn(async () => ({
    pages: [{ chats: [], nextCursor: null }],
    pageParams: [null],
  }));
  function Counts() {
    const { data } = useQuery({ queryKey: ['open-chat-count'], queryFn: queryCount });
    useQuery({ queryKey: listKey, queryFn: queryList });
    return <span>{data?.openCount} open chats</span>;
  }
  const view = render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <Counts />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('205 open chats');
  // This response represents a count read just before the reset committed.
  void qc.refetchQueries({ queryKey: ['open-chat-count'] });
  await waitFor(() => expect(queryCount).toHaveBeenCalledTimes(1));
  serverCount = 0;
  act(() => {
    for (let i = 0; i < 205; i++)
      socket.listeners.get('chat:updated')!({ jid: `${i}@s.whatsapp.net`, status: 'resolved' });
  });
  await screen.findByText('0 open chats');
  expect(queryCount).toHaveBeenCalledTimes(2); // The old request, then one fresh request.
  expect(aborted).toHaveBeenCalledTimes(1);
  expect(queryList).toHaveBeenCalledTimes(1);
  // An update queued just before unmount must not start another request afterward.
  act(() => socket.listeners.get('chat:updated')!({ jid: 'later@s.whatsapp.net', status: 'open' }));
  view.unmount();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(queryCount).toHaveBeenCalledTimes(2);
  qc.clear();
});

it('shares one list/count refresh between a new message and its chat update', async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const listKey = ['chats', { assigned: 'any' }];
  const list = { pages: [{ chats: [], nextCursor: null }], pageParams: [null] };
  qc.setQueryData(listKey, list);
  qc.setQueryData(['open-chat-count'], { openCount: 0 });
  const queryList = vi.fn(async () => list);
  const queryCount = vi.fn(async () => ({ openCount: 1 }));
  function Counts() {
    const { data } = useQuery({ queryKey: ['open-chat-count'], queryFn: queryCount });
    useQuery({ queryKey: listKey, queryFn: queryList });
    return <span>{data?.openCount} open chats</span>;
  }
  render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <Counts />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('0 open chats');
  act(() => {
    socket.listeners.get('message:new')!({
      id: 'incoming',
      chatJid: '1@s.whatsapp.net',
      clientId: null,
    });
    socket.listeners.get('chat:updated')!({ jid: '1@s.whatsapp.net', status: 'open' });
  });
  await screen.findByText('1 open chats');
  expect(queryCount).toHaveBeenCalledTimes(1);
  expect(queryList).toHaveBeenCalledTimes(1);
  qc.clear();
});

it('relabels cached group messages when a sender profile name changes', async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const group = 'team@g.us';
  const farah = '601@s.whatsapp.net';
  const groupMsg = (id: string, senderProfile: unknown) => ({
    id,
    chatJid: group,
    senderJid: farah,
    fromMe: false,
    clientId: null,
    senderProfile,
  });
  qc.setQueryData(['messages', group], {
    pages: [
      {
        messages: [
          groupMsg('G1', { chatJid: farah, name: 'Farah' }),
          groupMsg('G2', { chatJid: 'other@s.whatsapp.net', name: 'Ali' }),
        ],
        nextBefore: null,
      },
    ],
    pageParams: [null],
  });
  render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <span />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(socket.listeners.has('chat:updated')).toBe(true));
  const profiles = () =>
    (
      qc.getQueryData(['messages', group]) as {
        pages: { messages: { senderProfile: unknown }[] }[];
      }
    ).pages[0]!.messages.map((m) => m.senderProfile);
  act(() =>
    socket.listeners.get('chat:updated')!({
      jid: farah,
      type: 'dm',
      name: 'Farah Aziz',
      whatsappName: 'Farah 🌸',
      status: 'open',
    }),
  );
  expect(profiles()).toEqual([
    { chatJid: farah, name: 'Farah Aziz' },
    { chatJid: 'other@s.whatsapp.net', name: 'Ali' },
  ]);
  // Profile name cleared: the chat name falls back to the WhatsApp name.
  act(() =>
    socket.listeners.get('chat:updated')!({
      jid: farah,
      type: 'dm',
      name: 'Farah 🌸',
      whatsappName: 'Farah 🌸',
      status: 'open',
    }),
  );
  expect(profiles()).toEqual([null, { chatJid: 'other@s.whatsapp.net', name: 'Ali' }]);
  qc.clear();
});

it('refetches an open customer profile when its chat is updated live', async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const profileKey = ['customer-profile', '1@s.whatsapp.net'];
  let name = 'Farah';
  const queryProfile = vi.fn(async () => name);
  function Profile() {
    const { data } = useQuery({ queryKey: profileKey, queryFn: queryProfile });
    return <span>Profile {data}</span>;
  }
  render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <Profile />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Profile Farah');
  await waitFor(() => expect(socket.listeners.has('chat:updated')).toBe(true));
  name = 'Farah Aziz';
  act(() => socket.listeners.get('chat:updated')!({ jid: '1@s.whatsapp.net', status: 'open' }));
  await screen.findByText('Profile Farah Aziz');
  qc.clear();
});

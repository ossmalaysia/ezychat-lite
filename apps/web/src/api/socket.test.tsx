import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
  act(() => socket.listeners.get('connect')!());
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

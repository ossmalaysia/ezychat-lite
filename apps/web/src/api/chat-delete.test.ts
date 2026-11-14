import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { removeChatFromCache } from './chat-delete';
import { qk, type ChatsData } from './queries';
import { SAVE_DELAY_MS, startQueryPersistence, type KeyValueStorage } from './query-persist';

const A = '60111@s.whatsapp.net';
const B = '60222@s.whatsapp.net';
const filters = { assigned: 'any', status: 'open' } as const;

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

const list = (): ChatsData =>
  ({
    pages: [
      {
        chats: [
          { jid: A, name: 'Ann' },
          { jid: B, name: 'Bob' },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  }) as unknown as ChatsData;

afterEach(() => vi.useRealTimers());

describe('removeChatFromCache', () => {
  it('drops the chat from every list and its own queries, and the saved copy follows', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const qc = new QueryClient();
    const stop = startQueryPersistence(qc, { storage, buster: 'x', clearCaches: () => {} });
    qc.setQueryData(qk.me, { id: 7, displayName: 'Admin' });
    qc.setQueryData(qk.chats(filters), list());
    qc.setQueryData(qk.chats({ ...filters, status: 'resolved' }), list());
    // an empty entry (a first load still running) stays as it is
    qc.setQueryData(qk.chats({ ...filters, assigned: 'me' }), undefined);
    for (const key of [qk.chat(A), qk.messages(A), qk.notes(A), qk.customerProfile(A)])
      qc.setQueryData(key, { x: 1 });
    qc.setQueryData(qk.chat(B), { x: 1 });
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(storage.getItem('ezy.queries.7')).toContain(A);

    removeChatFromCache(qc, A);
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    stop();

    for (const f of [filters, { ...filters, status: 'resolved' as const }])
      expect(qc.getQueryData<ChatsData>(qk.chats(f))!.pages[0]!.chats.map((c) => c.jid)).toEqual([
        B,
      ]);
    for (const key of [qk.chat(A), qk.messages(A), qk.notes(A), qk.customerProfile(A)])
      expect(qc.getQueryData(key)).toBeUndefined();
    expect(qc.getQueryData(qk.chat(B))).toEqual({ x: 1 });
    const saved = storage.getItem('ezy.queries.7')!;
    expect(saved).toContain(B);
    expect(saved).not.toContain(A);
  });
});

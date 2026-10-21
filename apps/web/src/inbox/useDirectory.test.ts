import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@ezychat/shared';
import { buildDirectory, canOpenInbox, useDirectory } from './useDirectory';

const agent: User = {
  id: 2,
  username: 'daniel',
  displayName: 'Daniel',
  role: 'agent',
  mustChangePassword: false,
  disabled: false,
  createdAt: 0,
  locale: null,
};

describe('inbox access in the team directory', () => {
  it('admins, the AI member and rows without an inbox list open every inbox', () => {
    expect(canOpenInbox({ id: 1, displayName: 'A', role: 'admin', disabled: false }, 5)).toBe(true);
    expect(
      canOpenInbox(
        { id: 9, displayName: 'AI', role: 'agent', disabled: false, kind: 'ai', inboxIds: [] },
        5,
      ),
    ).toBe(true);
    expect(canOpenInbox({ id: 2, displayName: 'D', role: 'agent', disabled: false }, 5)).toBe(true);
    expect(
      canOpenInbox({ id: 2, displayName: 'D', role: 'agent', disabled: false, inboxIds: 'all' }, 5),
    ).toBe(true);
  });

  it('with several inboxes, an agent row without an inbox list opens no inbox', () => {
    const bare = { id: 2, displayName: 'D', role: 'agent' as const, disabled: false };
    expect(canOpenInbox(bare, 1, true)).toBe(false);
    expect(canOpenInbox({ ...bare, inboxIds: 'all' }, 2, true)).toBe(true);
    expect(canOpenInbox({ ...bare, role: 'admin' }, 2, true)).toBe(true);
  });

  it('an agent with no inboxes is not assignable for inbox 2', () => {
    const list = [
      { id: 2, displayName: 'Daniel', role: 'agent' as const, disabled: false, inboxIds: [] },
      { id: 3, displayName: 'Mei Ling', role: 'agent' as const, disabled: false },
      { id: 1, displayName: 'Aisyah', role: 'admin' as const, disabled: false },
    ];
    const multi = buildDirectory(null, true, list, { multiInbox: true });
    expect(multi.assignableFor(2).map((u) => u.displayName)).toEqual(['Aisyah']);
    // One inbox (Lite): a row without an inbox list stays assignable.
    const single = buildDirectory(null, true, list);
    expect(single.assignableFor(1).map((u) => u.displayName)).toEqual(['Aisyah', 'Mei Ling']);
  });

  it('agents open only their inboxes', () => {
    const u = { id: 2, displayName: 'D', role: 'agent' as const, disabled: false, inboxIds: [1] };
    expect(canOpenInbox(u, 1)).toBe(true);
    expect(canOpenInbox(u, 2)).toBe(false);
  });

  it('assignableFor lists active members of the chat’s inbox, sorted', () => {
    const dir = buildDirectory(null, true, [
      { id: 3, displayName: 'Mei Ling', role: 'agent', disabled: false, inboxIds: [2] },
      { id: 2, displayName: 'Daniel', role: 'agent', disabled: false, inboxIds: [1] },
      { id: 4, displayName: 'Ali', role: 'agent', disabled: true, inboxIds: [2] },
      { id: 1, displayName: 'Aisyah', role: 'admin', disabled: false },
    ]);
    expect(dir.assignableFor(2).map((u) => u.displayName)).toEqual(['Aisyah', 'Mei Ling']);
    expect(dir.assignableFor(1).map((u) => u.displayName)).toEqual(['Aisyah', 'Daniel']);
  });

  it('keeps the directory’s inbox list for the signed-in agent', () => {
    const dir = buildDirectory(agent, false, [
      { id: 2, displayName: 'Daniel', role: 'agent', disabled: false, inboxIds: [1] },
    ]);
    expect(dir.byId.get(2)?.inboxIds).toEqual([1]);
    expect(dir.assignableFor(2)).toEqual([]);
  });
});

describe('useDirectory', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function json(data: unknown, code = 200) {
    return new Response(JSON.stringify(data), {
      status: code,
      headers: { 'content-type': 'application/json' },
    });
  }

  function run(maxInboxes: number | null) {
    const admin = { ...agent, id: 1, displayName: 'Aisyah', role: 'admin' as const };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/me') return json(admin);
        if (url === '/api/users')
          return json({
            users: [admin, { ...agent, inboxIds: [] }, { ...agent, id: 3, displayName: 'Mei' }],
          });
        if (url === '/api/inboxes' && maxInboxes != null)
          return json({ inboxes: [], maxInboxes, canAdd: false });
        return json({ error: { code: 'not_found', message: 'nope' } }, 404);
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    return renderHook(() => useDirectory(), { wrapper });
  }

  it('fails closed for rows without an inbox list in a multi-inbox install', async () => {
    const { result } = run(3);
    await waitFor(() => expect(result.current.byId.size).toBe(3));
    await waitFor(() =>
      expect(result.current.assignableFor(2).map((u) => u.displayName)).toEqual(['Aisyah']),
    );
  });

  it('keeps rows without an inbox list assignable on a single-inbox server', async () => {
    const { result } = run(null);
    await waitFor(() => expect(result.current.byId.size).toBe(3));
    expect(result.current.assignableFor(1).map((u) => u.displayName)).toEqual(['Aisyah', 'Mei']);
  });
});

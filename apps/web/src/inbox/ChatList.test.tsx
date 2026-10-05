import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Chat } from '@wa-team-inbox/shared';
import type { ChatsData } from '../api/queries';
import type * as QueriesModule from '../api/queries';
import type * as ChatListItemModule from './ChatListItem';
import { ChatList, type ChatListProps } from './ChatList';
import { ProfileImageContext } from './ProfileImageContext';

const hooks = vi.hoisted(() => ({
  useActualQueries: false,
  query: {
    data: null as ChatsData | null,
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(async () => undefined),
  },
  renderRow: vi.fn<(jid: string) => void>(),
}));

vi.mock('../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useChats: (filters: QueriesModule.ChatFilters) =>
      hooks.useActualQueries ? actual.useChats(filters) : hooks.query,
  };
});
vi.mock('./ChatListItem', async (importOriginal) => {
  const actual = await importOriginal<typeof ChatListItemModule>();
  return {
    ...actual,
    ChatListItem: (props: ChatListItemModule.ChatListItemProps) => {
      hooks.renderRow(props.chat.jid);
      return <actual.ChatListItem {...props} />;
    },
  };
});

const defaultProps: ChatListProps = {
  filters: { assigned: 'any', status: 'open' },
  activeJid: null,
  directory: { me: null, isAdmin: false, byId: new Map(), assignable: [], nameOf: () => null },
};

function chat(index: number): Chat {
  return {
    jid: `${index}@s.whatsapp.net`,
    type: 'dm',
    name: `Customer ${index}`,
    avatarUrl: null,
    unreadCount: 0,
    lastMessageAt: 0,
    lastMessagePreview: 'Previous message',
    status: 'open',
    assignedTo: null,
    updatedAt: 0,
    phone: null,
  };
}

function chats(items: Chat[]) {
  hooks.query.data = { pages: [{ chats: items, nextCursor: null }], pageParams: [null] };
}

function list(props: Partial<ChatListProps> = {}) {
  return (
    <MemoryRouter>
      <ChatList {...defaultProps} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  hooks.useActualQueries = false;
  chats(Array.from({ length: 100 }, (_, index) => chat(index)));
  hooks.query.isPending = false;
  hooks.query.isError = false;
  hooks.query.hasNextPage = false;
  hooks.query.isFetchingNextPage = false;
  hooks.query.fetchNextPage.mockClear();
  hooks.renderRow.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('does not render unchanged rows when one live message updates a 100-chat list', () => {
  const view = render(list());
  expect(hooks.renderRow).toHaveBeenCalledTimes(100);
  hooks.renderRow.mockClear();
  const previous = hooks.query.data!.pages[0]!.chats;
  chats(
    previous.map((item, index) =>
      index === 25 ? { ...item, unreadCount: 1, lastMessagePreview: 'New live message' } : item,
    ),
  );
  view.rerender(list());
  expect(hooks.renderRow).toHaveBeenCalledTimes(1);
  expect(hooks.renderRow).toHaveBeenCalledWith('25@s.whatsapp.net');
  expect(screen.getByText('New live message')).toBeTruthy();
  expect(screen.getByLabelText('1 unread')).toBeTruthy();
});

it('updates both selected rows when the active conversation changes', () => {
  const first = '3@s.whatsapp.net';
  const next = '7@s.whatsapp.net';
  const view = render(list({ activeJid: first }));
  hooks.renderRow.mockClear();
  view.rerender(list({ activeJid: next }));
  expect(hooks.renderRow.mock.calls.map(([jid]) => jid)).toEqual([first, next]);
  expect(screen.getByText('Customer 3').closest('a')?.getAttribute('aria-current')).toBeNull();
  expect(screen.getByText('Customer 7').closest('a')?.getAttribute('aria-current')).toBe('page');
});

it('updates an assignment label when the team directory changes', () => {
  const item = { ...chat(0), assignedTo: 1 };
  chats([item, chat(1)]);
  const view = render(
    list({ directory: { ...defaultProps.directory, nameOf: (id) => (id === 1 ? 'Alice' : null) } }),
  );
  hooks.renderRow.mockClear();
  view.rerender(
    list({
      directory: { ...defaultProps.directory, nameOf: (id) => (id === 1 ? 'Alicia' : null) },
    }),
  );
  expect(hooks.renderRow).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Alicia')).toBeTruthy();
  expect(screen.queryByText('Alice')).toBeNull();
});

it('highlights chats you own and keeps teammates and unassigned rows calm', () => {
  chats([{ ...chat(0), assignedTo: 1 }, { ...chat(1), assignedTo: 2 }, chat(2)]);
  const me = { id: 1 } as ChatListProps['directory']['me'];
  render(
    list({
      directory: {
        ...defaultProps.directory,
        me,
        nameOf: (id, opts) =>
          id === 1 ? (opts?.youLabel ? 'You' : 'Jazz') : id === 2 ? 'Jee Fong' : null,
      },
    }),
  );
  const mine = screen.getByTitle('Assigned to You');
  const theirs = screen.getByTitle('Assigned to Jee Fong');
  expect(mine.className).toContain('text-primary');
  expect(theirs.className).toContain('text-muted-foreground');
  expect(theirs.className).not.toContain('text-primary');
  expect(
    screen.getByText('Customer 2').closest('a')?.querySelector('[title^="Assigned to"]'),
  ).toBeNull();
});

it('still retries profile images when WhatsApp reconnects', () => {
  chats([{ ...chat(0), avatarUrl: '/api/chats/0/avatar' }]);
  const tree = (ready: boolean, revision: number) => (
    <ProfileImageContext.Provider value={{ ready, revision }}>
      {list()}
    </ProfileImageContext.Provider>
  );
  const view = render(tree(false, 0));
  expect(view.container.querySelector('img')).toBeNull();
  view.rerender(tree(true, 1));
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
    '/api/chats/0/avatar?connection=1',
  );
});

it('deduplicates chats across pages and retains the first copy', () => {
  const first = chat(0);
  hooks.query.data = {
    pages: [
      { chats: [first], nextCursor: 'next' },
      { chats: [{ ...first, name: 'Old duplicate' }, chat(1)], nextCursor: null },
    ],
    pageParams: [null, 'next'],
  };
  render(list());
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.getByText('Customer 0')).toBeTruthy();
  expect(screen.queryByText('Old duplicate')).toBeNull();
});

it('coalesces repeated sentinel and manual next-page requests', async () => {
  let notify: IntersectionObserverCallback | undefined;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  hooks.useActualQueries = true;
  let resolveNext!: (response: Response) => void;
  const nextPage = new Promise<Response>((resolve) => {
    resolveNext = resolve;
  });
  const nextSignals: (AbortSignal | null | undefined)[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (new URL(url, 'https://test.local').searchParams.has('cursor')) {
      nextSignals.push(init?.signal);
      return nextPage;
    }
    return new Response(JSON.stringify({ chats: [chat(0)], nextCursor: 'next' }));
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{list()}</QueryClientProvider>);
  try {
    await screen.findByText('Customer 0');
    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    act(() => {
      const entries = [{ isIntersecting: true }] as IntersectionObserverEntry[];
      notify!(entries, {} as IntersectionObserver);
      notify!(entries, {} as IntersectionObserver);
      fireEvent.click(loadMore);
    });
    expect(fetch).toHaveBeenCalledTimes(2); // Initial page plus one shared next-page request.
    expect(nextSignals).toHaveLength(1);
    expect(nextSignals[0]?.aborted).toBe(false);
    await act(async () => {
      resolveNext(new Response(JSON.stringify({ chats: [chat(1)], nextCursor: null })));
    });
    await screen.findByText('Customer 1');
  } finally {
    view.unmount();
    client.clear();
  }
});

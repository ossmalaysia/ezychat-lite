import { useEffect, useMemo, useRef } from 'react';
import type { Chat } from '@wa-team-inbox/shared';
import { useChats, type ChatFilters } from '../api/queries';
import { Button, Spinner } from '../components/ui';
import { ChatListItem } from './ChatListItem';
import type { Directory } from './useDirectory';

export interface ChatListProps {
  filters: ChatFilters;
  activeJid: string | null;
  directory: Directory;
}

const emptyCopy: Record<ChatFilters['assigned'], string> = {
  me: 'No chats are assigned to you.',
  none: 'Every chat has an owner. Nice work.',
  any: 'No chats yet. New WhatsApp conversations will appear here.',
};

export function ChatList({ filters, activeJid, directory }: ChatListProps) {
  const q = useChats(filters);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;

  const chats = useMemo(() => {
    const seen = new Set<string>();
    const out: Chat[] = [];
    for (const p of q.data?.pages ?? [])
      for (const c of p.chats) {
        if (seen.has(c.jid)) continue;
        seen.add(c.jid);
        out.push(c);
      }
    return out;
  }, [q.data]);

  // Infinite scroll: load the next page when the bottom sentinel becomes visible.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage)
          void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (q.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-emerald-600">
        <Spinner className="size-6" label="Loading chats" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        <p>Couldn’t load chats. {q.error instanceof Error ? q.error.message : ''}</p>
        <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {filters.q
          ? `No chats match “${filters.q}”.`
          : filters.status === 'resolved'
            ? 'No resolved chats here.'
            : emptyCopy[filters.assigned]}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
        {chats.map((c) => (
          <li key={c.jid}>
            <ChatListItem
              chat={c}
              active={c.jid === activeJid}
              assigneeName={directory.nameOf(c.assignedTo, { youLabel: true })}
            />
          </li>
        ))}
      </ul>
      <div ref={sentinelRef} className="h-px" />
      {isFetchingNextPage && (
        <div className="flex justify-center p-3 text-emerald-600">
          <Spinner className="size-5" label="Loading more chats" />
        </div>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <div className="flex justify-center p-2">
          <Button variant="ghost" size="sm" onClick={() => void fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

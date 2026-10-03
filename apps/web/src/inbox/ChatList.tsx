import { useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { Chat } from '@wa-team-inbox/shared';
import { useChats, type ChatFilters } from '../api/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner, EmptyState } from '@/components/app';
import { ChatListItem } from './ChatListItem';
import type { Directory } from './useDirectory';

export interface ChatListProps {
  filters: ChatFilters;
  activeJid: string | null;
  directory: Directory;
  onResetFilters?(): void;
}

const emptyCopy: Record<ChatFilters['assigned'], { title: string; description: string }> = {
  me: { title: 'Nothing assigned to you', description: 'No chats are assigned to you.' },
  none: { title: 'All caught up', description: 'Every chat has an owner. Nice work.' },
  any: { title: 'No chats yet', description: 'New WhatsApp conversations will appear here.' },
};

function ChatRowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3 px-3 py-2.5">
      <Skeleton className="size-12 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-3.5 w-3/4" />
      </div>
    </div>
  );
}

export function ChatList({ filters, activeJid, directory, onResetFilters }: ChatListProps) {
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
      <div className="min-h-0 flex-1 overflow-hidden" role="status" aria-label="Loading chats">
        {Array.from({ length: 8 }, (_, i) => (
          <ChatRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="p-3">
        <Banner
          tone="danger"
          title="Couldn’t load chats"
          action={
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              Try again
            </Button>
          }
        >
          {q.error instanceof Error ? q.error.message : null}
        </Banner>
      </div>
    );
  }

  if (chats.length === 0) {
    const copy = filters.q
      ? { title: 'No results', description: `No chats match “${filters.q}”.` }
      : filters.status === 'resolved'
        ? { title: 'No resolved chats', description: 'No resolved chats here.' }
        : emptyCopy[filters.assigned];
    return (
      <EmptyState
        className="flex-1"
        illustration={
          filters.q ? '/illustrations/no-results.png' : '/illustrations/empty-inbox.png'
        }
        title={copy.title}
        description={copy.description}
        action={
          onResetFilters &&
          (filters.q || filters.assigned !== 'any' || filters.status === 'resolved') ? (
            <Button variant="outline" size="touch" onClick={onResetFilters}>
              Show all open chats
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ul className="divide-y divide-border/60">
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
        <div className="flex justify-center p-3 text-muted-foreground" role="status">
          <Loader2 className="size-5 animate-spin" aria-label="Loading more chats" />
        </div>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <div className="flex justify-center p-2">
          <Button variant="ghost" size="touch" onClick={() => void fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

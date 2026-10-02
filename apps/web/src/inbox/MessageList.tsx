import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '@wa-team-inbox/shared';
import { Spinner } from '../components/legacy';
import { formatDay } from '../lib/format';
import { EventItem, NoteItem } from './EventItem';
import { MessageBubble } from './MessageBubble';
import type { TimelineItem } from './timeline';
import type { Directory } from './useDirectory';

export interface MessageListProps {
  items: TimelineItem[];
  messagesById: Map<string, Message>;
  isGroup: boolean;
  directory: Directory;
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder(): void;
  onRetry(m: Message): void;
  retryingId: string | null;
  footer?: React.ReactNode;
}

const NEAR_BOTTOM_PX = 150;

function DaySeparator({ date }: { date: number }) {
  return (
    <div className="sticky top-1 z-10 flex justify-center py-2" role="separator">
      <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm backdrop-blur dark:bg-neutral-800/90 dark:text-neutral-300">
        {formatDay(date)}
      </span>
    </div>
  );
}

export function MessageList({
  items,
  messagesById,
  isGroup,
  directory,
  loading,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
  retryingId,
  footer,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prev = useRef<{ first?: string; last?: string; height: number; initialized: boolean }>({
    height: 0,
    initialized: false,
  });
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottom.current = near;
    setShowJump(!near);
  }, []);

  // Keep scroll position sensible as items change.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = items[0]?.key;
    const lastItem = items[items.length - 1];
    const last = lastItem?.key;
    const p = prev.current;
    if (!p.initialized) {
      if (items.length > 0) {
        scrollToBottom();
        p.initialized = true;
      }
    } else if (first !== p.first && last === p.last) {
      // Older page prepended: keep the visible content where it was.
      el.scrollTop += el.scrollHeight - p.height;
    } else if (last !== p.last) {
      const mine = lastItem?.kind === 'message' && lastItem.message.fromMe && lastItem.message.sentByUserId === directory.me?.id;
      if (nearBottom.current || mine) scrollToBottom();
    }
    p.first = first;
    p.last = last;
    p.height = el.scrollHeight;
  }, [items, scrollToBottom, directory.me?.id]);

  // Load older messages when the top sentinel is visible.
  useEffect(() => {
    const el = topRef.current;
    const root = scrollRef.current;
    if (!el || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasOlder && !loadingOlder && prev.current.initialized)
          onLoadOlder();
      },
      { root, rootMargin: '300px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasOlder, loadingOlder, onLoadOlder]);

  const onMediaLoad = useCallback(() => {
    if (nearBottom.current) scrollToBottom();
    if (scrollRef.current) prev.current.height = scrollRef.current.scrollHeight;
  }, [scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain bg-neutral-100 py-2 dark:bg-neutral-950"
        aria-label="Messages"
        role="log"
      >
        <div ref={topRef} className="h-px" />
        {loadingOlder && (
          <div className="flex justify-center py-2 text-emerald-600">
            <Spinner className="size-5" label="Loading older messages" />
          </div>
        )}
        {!hasOlder && !loading && items.length > 0 && (
          <p className="py-2 text-center text-xs text-neutral-400 dark:text-neutral-500">
            Start of conversation
          </p>
        )}
        {loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-emerald-600">
            <Spinner className="size-6" label="Loading messages" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            No messages yet.
          </p>
        ) : (
          items.map((it) => {
            switch (it.kind) {
              case 'day':
                return <DaySeparator key={it.key} date={it.date} />;
              case 'event':
                return <EventItem key={it.key} event={it.event} directory={directory} />;
              case 'note':
                return <NoteItem key={it.key} note={it.note} directory={directory} />;
              case 'message': {
                const m = it.message;
                const outboundLabel = m.fromMe
                  ? m.sentByUserId == null
                    ? 'via phone'
                    : directory.nameOf(m.sentByUserId)
                  : null;
                return (
                  <MessageBubble
                    key={it.key}
                    message={m}
                    showSender={isGroup}
                    outboundLabel={outboundLabel}
                    quoted={m.quotedId ? (messagesById.get(m.quotedId) ?? null) : null}
                    onRetry={onRetry}
                    retrying={retryingId === m.id}
                    onMediaLoad={onMediaLoad}
                  />
                );
              }
            }
          })
        )}
        {footer}
      </div>
      {showJump && (
        <button
          type="button"
          aria-label="Jump to latest"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 right-3 inline-flex size-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-md hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

import clsx from 'clsx';
import { Link, useLocation } from 'react-router-dom';
import type { Chat } from '@wa-team-inbox/shared';
import { Avatar } from '../components/legacy';
import { formatListTime } from '../lib/format';
import { encodeJid, formatJid } from '../lib/jid';

export interface ChatListItemProps {
  chat: Chat;
  active: boolean;
  /** Assignee display name ("You" for the current user), or null when unassigned. */
  assigneeName: string | null;
}

export function GroupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-label="Group" role="img">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" strokeLinecap="round" />
      <path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2" strokeLinecap="round" />
    </svg>
  );
}

export function ChatListItem({ chat, active, assigneeName }: ChatListItemProps) {
  const name = chat.name || formatJid(chat.jid);
  const unread = chat.unreadCount > 0;
  const { pathname } = useLocation();
  return (
    <Link
      to={`/chats/${encodeJid(chat.jid)}`}
      // Lets the mobile back button pop history instead of pushing "/" again.
      state={pathname === '/' ? { fromList: true } : undefined}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors',
        active
          ? 'bg-emerald-50 dark:bg-emerald-950/40'
          : 'hover:bg-neutral-50 active:bg-neutral-100 dark:hover:bg-neutral-900 dark:active:bg-neutral-800',
      )}
    >
      <Avatar name={name} src={chat.avatarUrl} seed={chat.jid} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1">
            {chat.type === 'group' && (
              <GroupIcon className="size-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
            )}
            <span
              className={clsx(
                'truncate text-[15px]',
                unread ? 'font-semibold text-neutral-900 dark:text-neutral-50' : 'font-medium text-neutral-800 dark:text-neutral-100',
              )}
            >
              {name}
            </span>
          </span>
          <time
            className={clsx(
              'shrink-0 text-xs',
              unread ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400',
            )}
            dateTime={chat.lastMessageAt ? new Date(chat.lastMessageAt).toISOString() : undefined}
          >
            {formatListTime(chat.lastMessageAt)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p
            className={clsx(
              'min-w-0 flex-1 truncate text-sm',
              unread ? 'text-neutral-800 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-400',
            )}
          >
            {chat.lastMessagePreview ?? ' '}
          </p>
          {assigneeName && (
            <span
              className="max-w-24 shrink-0 truncate rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900/50 dark:text-sky-200"
              title={`Assigned to ${assigneeName}`}
            >
              {assigneeName}
            </span>
          )}
          {chat.status === 'resolved' && (
            <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              Resolved
            </span>
          )}
          {unread && (
            <span
              className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold text-white dark:bg-emerald-500 dark:text-neutral-950"
              aria-label={`${chat.unreadCount} unread`}
            >
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

import { Link, useLocation } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { Chat } from '@wa-team-inbox/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatListTime } from '../lib/format';
import { encodeJid, formatJid } from '../lib/jid';
import { ChatAvatar } from './ChatAvatar';

export interface ChatListItemProps {
  chat: Chat;
  active: boolean;
  /** Assignee display name ("You" for the current user), or null when unassigned. */
  assigneeName: string | null;
  /** The current user owns this chat: the chip gets the accent outline. */
  assignedToMe?: boolean;
}

export function GroupIcon({ className }: { className?: string }) {
  return <Users className={className} role="img" aria-label="Group" />;
}

export function ChatListItem({ chat, active, assigneeName, assignedToMe = false }: ChatListItemProps) {
  const name = chat.name || formatJid(chat.jid);
  const unread = chat.unreadCount > 0;
  const { pathname } = useLocation();
  return (
    <Link
      to={`/chats/${encodeJid(chat.jid)}`}
      // Lets the mobile back button pop history instead of pushing "/" again.
      state={pathname === '/' ? { fromList: true } : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-16 items-center gap-3 px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active
          ? 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary'
          : 'hover:bg-muted/60 active:bg-muted',
      )}
    >
      <ChatAvatar name={name} src={chat.avatarUrl} seed={chat.jid} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1">
            {chat.type === 'group' && <GroupIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span
              className={cn(
                'truncate text-[15px] text-foreground',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {name}
            </span>
          </span>
          <time
            className={cn(
              'shrink-0 text-xs',
              unread ? 'font-semibold text-unread' : 'text-muted-foreground',
            )}
            dateTime={chat.lastMessageAt ? new Date(chat.lastMessageAt).toISOString() : undefined}
          >
            {formatListTime(chat.lastMessageAt)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {chat.lastMessagePreview ?? ' '}
          </p>
          {assigneeName && (
            <Badge
              variant="outline"
              className={cn(
                'max-w-24 truncate px-1.5 text-[11px]',
                // Outline only: the solid accent is reserved for the unread count.
                assignedToMe ? 'border-primary/40 font-medium text-primary' : 'text-muted-foreground',
              )}
              title={`Assigned to ${assigneeName}`}
            >
              <span className="truncate">{assigneeName}</span>
            </Badge>
          )}
          {chat.status === 'resolved' && (
            <Badge variant="secondary" className="px-1.5 text-[11px]">
              Resolved
            </Badge>
          )}
          {unread && (
            <Badge
              className="min-w-5 bg-unread px-1.5 text-[11px] font-bold text-primary-foreground"
              aria-label={`${chat.unreadCount} unread`}
            >
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  );
}

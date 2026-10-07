import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserRound, Users } from 'lucide-react';
import type { Chat } from '@wa-team-inbox/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatListTime } from '../lib/format';
import { encodeJid } from '../lib/jid';
import { chatTitle } from './chat-title';
import { ChatAvatar } from './ChatAvatar';
import { useGuardedLinkClick } from './navigation-guard';

export interface ChatListItemProps {
  chat: Chat;
  active: boolean;
  /** Assignee display name ("You" for the current user), or null when unassigned. */
  assigneeName: string | null;
  /** The current user owns this chat: the chip gets the accent outline. */
  assignedToMe?: boolean;
}

export function GroupIcon({ className }: { className?: string }) {
  const { t } = useTranslation('inbox');
  return <Users className={className} role="img" aria-label={t('chatListItem.group')} />;
}

export function ChatListItem({
  chat,
  active,
  assigneeName,
  assignedToMe = false,
}: ChatListItemProps) {
  // Subscribes to language changes so the localized list time re-renders.
  const { t } = useTranslation('inbox');
  const name = chatTitle(chat, t);
  const unread = chat.unreadCount > 0;
  const tags = chat.tags ?? [];
  const { pathname } = useLocation();
  const to = `/chats/${encodeJid(chat.jid)}`;
  // Lets the mobile back button pop history instead of pushing "/" again.
  const state = pathname === '/' ? { fromList: true } : undefined;
  // Unsaved customer edits in the open conversation ask before switching chats.
  const onClick = useGuardedLinkClick(to, { state });
  return (
    <Link
      to={to}
      state={state}
      onClick={onClick}
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
            {chat.type === 'group' && (
              <GroupIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
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
              // The preview keeps at least ~12 characters; the tag chips shrink first.
              'min-w-24 flex-1 truncate text-sm',
              unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {chat.lastMessagePreview ?? ' '}
          </p>
          {assigneeName && (
            <Badge
              variant="outline"
              className={cn(
                'max-w-24 px-1.5 text-xs sm:max-w-28',
                // Outline only: the solid accent is reserved for the unread count.
                assignedToMe
                  ? 'border-primary/40 font-medium text-primary'
                  : 'text-muted-foreground',
              )}
              title={t('chatListItem.assignedTo', { name: assigneeName })}
            >
              {/* The person icon tells the assignee apart from the (filled) tag chips. */}
              <UserRound aria-hidden="true" />
              <span className="truncate">{assigneeName}</span>
            </Badge>
          )}
          {tags.length > 0 && (
            // Tags shrink (and truncate) before anything else so the row never overflows at 360px.
            // Phones show one tag, wider screens two; each width gets its own "+N".
            <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
              {tags.slice(0, 2).map((tag, i) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className={cn(
                    'min-w-0 max-w-20 shrink px-1.5 text-xs font-normal',
                    i === 1 && 'hidden sm:inline-flex',
                  )}
                  title={tag}
                >
                  <span className="truncate">{tag}</span>
                </Badge>
              ))}
              {tags.length > 1 && (
                <Badge
                  variant="secondary"
                  className="px-1.5 text-xs font-normal sm:hidden"
                  title={tags.slice(1).join(', ')}
                >
                  {t('chatListItem.moreTags', { count: tags.length - 1 })}
                </Badge>
              )}
              {tags.length > 2 && (
                <Badge
                  variant="secondary"
                  className="hidden px-1.5 text-xs font-normal sm:inline-flex"
                  title={tags.slice(2).join(', ')}
                >
                  {t('chatListItem.moreTags', { count: tags.length - 2 })}
                </Badge>
              )}
            </span>
          )}
          {chat.status === 'resolved' && (
            <Badge variant="secondary" className="max-w-24 truncate px-1.5 text-xs">
              {t('chatListItem.resolved')}
            </Badge>
          )}
          {unread && (
            <Badge
              className="min-w-5 bg-unread px-1.5 text-[11px] font-bold text-primary-foreground"
              aria-label={t('chatListItem.unread', { count: chat.unreadCount })}
            >
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  );
}

import type { Inbox } from '@ezychat/shared';
import { cn } from '@/lib/utils';

const TONE: Record<Inbox['tone'], string> = {
  primary: 'border-primary/40 bg-primary/10 text-primary',
  warning: 'border-warning/50 bg-warning/10 text-foreground',
  info: 'border-info/40 bg-info/10 text-foreground',
  success: 'border-success/40 bg-success/10 text-foreground',
};

/** The inbox a chat belongs to, in that inbox's colour (shown only with two or more inboxes). */
export function InboxChip({
  inbox,
  className,
}: Readonly<{ inbox: Pick<Inbox, 'name' | 'tone'>; className?: string }>) {
  return (
    <span
      data-testid="inbox-chip"
      data-tone={inbox.tone}
      title={inbox.name}
      className={cn(
        'inline-flex max-w-[12rem] items-center truncate rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[inbox.tone],
        className,
      )}
    >
      {inbox.name}
    </span>
  );
}

import { ArrowLeft, CheckCircle2, NotebookPen, RotateCcw } from 'lucide-react';
import type { Chat } from '@wa-team-inbox/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatJid } from '../lib/jid';
import { ChatAvatar } from './ChatAvatar';
import { GroupIcon } from './ChatListItem';
import type { Directory } from './useDirectory';

export interface ConversationHeaderProps {
  chat: Chat;
  directory: Directory;
  onBack(): void;
  onAssign(userId: number | null): void;
  onToggleStatus(): void;
  notesOpen: boolean;
  notesCount: number;
  onToggleNotes(): void;
  busy?: boolean;
}

const UNASSIGNED = 'none';

export function ConversationHeader({
  chat,
  directory,
  onBack,
  onAssign,
  onToggleStatus,
  notesOpen,
  notesCount,
  onToggleNotes,
  busy,
}: ConversationHeaderProps) {
  const name = chat.name || formatJid(chat.jid);
  const phone = formatJid(chat.jid);
  const resolved = chat.status === 'resolved';

  // Options: active team members (from the team directory) + current assignee.
  const options = [...directory.assignable];
  if (chat.assignedTo != null && !options.some((u) => u.id === chat.assignedTo)) {
    const known = directory.byId.get(chat.assignedTo);
    options.push(
      known ?? {
        id: chat.assignedTo,
        displayName: directory.nameOf(chat.assignedTo) ?? `Agent #${chat.assignedTo}`,
        role: 'agent',
        disabled: false,
      },
    );
  }

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b bg-surface px-1.5 py-1.5 sm:px-3">
      <Button
        variant="ghost"
        size="icon-touch"
        onClick={onBack}
        aria-label="Back to chats"
        className="text-muted-foreground md:hidden"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </Button>
      <ChatAvatar name={name} src={chat.avatarUrl} seed={chat.jid} size="md" className="hidden sm:flex" />
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-1 truncate text-base font-semibold text-foreground">
          {chat.type === 'group' && <GroupIcon className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{name}</span>
        </h2>
        <p className="truncate text-xs text-muted-foreground">
          {phone}
          {resolved && ' · Resolved'}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-touch"
        onClick={onToggleNotes}
        aria-pressed={notesOpen}
        aria-label={`Notes (${notesCount})`}
        title="Internal notes"
        className={cn(
          'relative',
          notesOpen ? 'bg-note text-note-foreground hover:bg-note' : 'text-muted-foreground',
        )}
      >
        <NotebookPen className="size-5" aria-hidden="true" />
        {notesCount > 0 && (
          <span className="absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full border border-note-border bg-note px-1 text-[10px] font-bold text-note-foreground">
            {notesCount}
          </span>
        )}
      </Button>
      <div className="flex w-full items-center gap-2 px-1 md:w-auto md:px-0">
        <Select
          value={chat.assignedTo == null ? UNASSIGNED : String(chat.assignedTo)}
          disabled={busy}
          onValueChange={(v) => onAssign(v === UNASSIGNED ? null : Number(v))}
        >
          <SelectTrigger
            id={`assign-${chat.jid}`}
            aria-label="Assigned to"
            className="h-11! min-w-0 flex-1 bg-surface text-base md:w-44 md:flex-none md:text-sm"
          >
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value={UNASSIGNED} className="min-h-11 md:min-h-8">
              Unassigned
            </SelectItem>
            {options.map((u) => (
              <SelectItem key={u.id} value={String(u.id)} className="min-h-11 md:min-h-8">
                {u.id === directory.me?.id ? `${u.displayName} (you)` : u.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={resolved ? 'outline' : 'default'}
          size="touch"
          onClick={onToggleStatus}
          disabled={busy}
          className="shrink-0"
        >
          {resolved ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <CheckCircle2 aria-hidden="true" />
          )}
          {resolved ? 'Reopen' : 'Resolve'}
        </Button>
      </div>
    </header>
  );
}

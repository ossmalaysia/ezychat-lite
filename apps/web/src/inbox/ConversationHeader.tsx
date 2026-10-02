import clsx from 'clsx';
import type { Chat } from '@wa-team-inbox/shared';
import { Avatar, Button } from '../components/legacy';
import { formatJid } from '../lib/jid';
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
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-neutral-200 bg-white px-1.5 py-1.5 sm:px-3 dark:border-neutral-800 dark:bg-neutral-900">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to chats"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Avatar name={name} src={chat.avatarUrl} seed={chat.jid} size="md" className="hidden sm:inline-flex" />
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-1 truncate text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {chat.type === 'group' && <GroupIcon className="size-4 shrink-0 text-neutral-400" />}
          <span className="truncate">{name}</span>
        </h2>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {phone}
          {resolved && ' · Resolved'}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggleNotes}
        aria-pressed={notesOpen}
        aria-label={`Notes (${notesCount})`}
        title="Internal notes"
        className={clsx(
          'relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg',
          notesOpen
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
            : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 4h14v11l-5 5H5z" strokeLinejoin="round" />
          <path d="M14 20v-5h5M8 9h8M8 13h4" strokeLinecap="round" />
        </svg>
        {notesCount > 0 && (
          <span className="absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
            {notesCount}
          </span>
        )}
      </button>
      <div className="flex w-full items-center gap-2 px-1 md:w-auto md:px-0">
        <label className="sr-only" htmlFor={`assign-${chat.jid}`}>
          Assigned to
        </label>
        <select
          id={`assign-${chat.jid}`}
          value={chat.assignedTo ?? ''}
          disabled={busy}
          onChange={(e) => onAssign(e.target.value === '' ? null : Number(e.target.value))}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 text-base text-neutral-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 md:w-44 md:flex-none md:text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          <option value="">Unassigned</option>
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.id === directory.me?.id ? `${u.displayName} (you)` : u.displayName}
            </option>
          ))}
        </select>
        <Button
          variant={resolved ? 'secondary' : 'primary'}
          size="sm"
          onClick={onToggleStatus}
          disabled={busy}
          className="shrink-0"
        >
          {resolved ? 'Reopen' : 'Resolve'}
        </Button>
      </div>
    </header>
  );
}

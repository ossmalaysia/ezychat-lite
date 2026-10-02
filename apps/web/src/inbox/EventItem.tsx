import { Lock } from 'lucide-react';
import type { ChatEvent, Note } from '@wa-team-inbox/shared';
import { formatTime } from '../lib/format';
import type { Directory } from './useDirectory';

function payloadUserId(payload: Record<string, unknown>): number | null {
  for (const k of ['assignedTo', 'to', 'userId', 'assigneeId']) {
    const v = payload[k];
    if (typeof v === 'number') return v;
  }
  return null;
}

export function describeEvent(e: ChatEvent, dir: Directory): string {
  const actor = e.actorId == null ? 'System' : (dir.nameOf(e.actorId, { youLabel: true }) ?? 'Someone');
  switch (e.type) {
    case 'assigned': {
      const to = payloadUserId(e.payload);
      if (to != null && to === e.actorId) return `${actor} took this chat`;
      return `${actor} assigned this chat to ${to == null ? 'someone' : dir.nameOf(to, { youLabel: true })}`;
    }
    case 'unassigned':
      return `${actor} unassigned this chat`;
    case 'resolved':
      return `${actor} resolved this chat`;
    case 'reopened':
      return e.actorId == null ? 'Chat reopened by a new message' : `${actor} reopened this chat`;
  }
}

/** Centered chip for assignment / status events. */
export function EventItem({ event, directory }: { event: ChatEvent; directory: Directory }) {
  return (
    <div className="flex justify-center px-3 py-1">
      <span className="max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
        {describeEvent(event, directory)} · {formatTime(event.at)}
      </span>
    </div>
  );
}

/** Amber internal-note card shown inline in the timeline (never looks like a bubble). */
export function NoteItem({ note, directory }: { note: Note; directory: Directory }) {
  return (
    <div className="flex justify-center px-3 py-1">
      <div className="w-full max-w-md rounded-lg border border-dashed border-note-border bg-note px-3 py-2 text-sm text-note-foreground shadow-sm">
        <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold">
          <Lock className="size-3 shrink-0" aria-hidden="true" />
          <span>Internal note</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{directory.nameOf(note.userId, { youLabel: true })}</span>
          <span className="ml-auto shrink-0 font-normal opacity-80">{formatTime(note.createdAt)}</span>
        </p>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.body}</p>
      </div>
    </div>
  );
}

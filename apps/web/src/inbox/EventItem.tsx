import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import type { ChatEvent, Note } from '@wa-team-inbox/shared';
import { i18n } from '@/i18n';
import { formatTime } from '../lib/format';
import type { Directory } from './useDirectory';

function payloadUserId(payload: Record<string, unknown>): number | null {
  for (const k of ['assignedTo', 'to', 'userId', 'assigneeId']) {
    const v = payload[k];
    if (typeof v === 'number') return v;
  }
  return null;
}

/** Localized sentence for a chat event, in the active UI language. */
export function describeEvent(e: ChatEvent, dir: Directory): string {
  const actor =
    e.actorId == null
      ? i18n.t('inbox:events.system')
      : (dir.nameOf(e.actorId, { youLabel: true }) ?? i18n.t('inbox:events.someone'));
  switch (e.type) {
    case 'assigned': {
      const to = payloadUserId(e.payload);
      if (to != null && to === e.actorId)
        return e.payload.reason === 'reply'
          ? i18n.t('inbox:events.tookByReply', { actor })
          : i18n.t('inbox:events.took', { actor });
      const assignee =
        to == null ? i18n.t('inbox:events.someoneLower') : dir.nameOf(to, { youLabel: true });
      return i18n.t('inbox:events.assigned', { actor, assignee });
    }
    case 'unassigned':
      return e.payload.reason === 'resolved'
        ? i18n.t('inbox:events.returned')
        : i18n.t('inbox:events.unassigned', { actor });
    case 'resolved':
      return i18n.t('inbox:events.resolved', { actor });
    case 'reopened':
      return e.actorId == null
        ? i18n.t('inbox:events.reopenedByMessage')
        : i18n.t('inbox:events.reopened', { actor });
  }
}

/** Centered chip for assignment / status events. */
export function EventItem({ event, directory }: { event: ChatEvent; directory: Directory }) {
  useTranslation(); // re-render on language change
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
  const { t } = useTranslation('inbox');
  return (
    <div className="flex justify-center px-3 py-1">
      <div className="w-full max-w-md rounded-lg border border-dashed border-note-border bg-note px-3 py-2 text-sm text-note-foreground shadow-sm">
        <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold">
          <Lock className="size-3 shrink-0" aria-hidden="true" />
          <span>{t('events.internalNote')}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{directory.nameOf(note.userId, { youLabel: true })}</span>
          <span className="ml-auto shrink-0 font-normal opacity-80">
            {formatTime(note.createdAt)}
          </span>
        </p>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.body}</p>
      </div>
    </div>
  );
}

import type React from 'react';
import { useState } from 'react';
import type { Note } from '@wa-team-inbox/shared';
import { useAddNote } from '../api/queries';
import { Button } from '../components/ui';
import { formatDateTime } from '../lib/format';
import type { Directory } from './useDirectory';

export interface NotesPanelProps {
  jid: string;
  notes: Note[];
  loading: boolean;
  directory: Directory;
  onClose(): void;
}

/**
 * Internal notes (never sent to the customer). Full-screen sheet on phones,
 * right-hand side panel on >= md.
 */
export function NotesPanel({ jid, notes, loading, directory, onClose }: NotesPanelProps) {
  const [body, setBody] = useState('');
  const add = useAddNote(jid);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = body.trim();
    if (!v) return;
    add.mutate(v, { onSuccess: () => setBody('') });
  }

  const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <aside
      aria-label="Internal notes"
      className="safe-top safe-x fixed inset-0 z-40 flex flex-col bg-white md:static md:z-auto md:w-80 md:shrink-0 md:border-l md:border-neutral-200 md:pt-0 dark:bg-neutral-900 md:dark:border-neutral-800"
    >
      <div className="flex items-center gap-2 border-b border-neutral-200 py-1 pl-4 pr-1.5 dark:border-neutral-800">
        <h3 className="flex-1 py-2 text-sm font-semibold">Internal notes</h3>
        <button
          type="button"
          aria-label="Close notes"
          onClick={onClose}
          className="inline-flex size-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="px-4 pt-2 text-xs text-neutral-500 dark:text-neutral-400">
        Only your team can see notes. They are never sent on WhatsApp.
      </p>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3">
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No notes yet.</p>
        ) : (
          sorted.map((n) => (
            <div
              key={n.id}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-100"
            >
              <p className="mb-0.5 flex gap-2 text-xs text-amber-800 dark:text-amber-300">
                <span className="truncate font-semibold">{directory.nameOf(n.userId, { youLabel: true })}</span>
                <span className="ml-auto shrink-0">{formatDateTime(n.createdAt)}</span>
              </p>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{n.body}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={submit} className="safe-bottom border-t border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-col gap-2 p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={8192}
            aria-label="New note"
            placeholder="Add a note for your team"
            className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          {add.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {add.error instanceof Error ? add.error.message : 'Could not save note'}
            </p>
          )}
          <Button type="submit" loading={add.isPending} disabled={!body.trim()}>
            Add note
          </Button>
        </div>
      </form>
    </aside>
  );
}

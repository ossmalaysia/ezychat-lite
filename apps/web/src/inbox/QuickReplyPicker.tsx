import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import type { QuickReply } from '@wa-team-inbox/shared';
import { truncate } from '../lib/format';

/** Quick replies whose shortcut starts with `query` (case-insensitive), sorted by shortcut. */
export function filterQuickReplies(replies: QuickReply[], query: string): QuickReply[] {
  const q = query.trim().toLowerCase();
  return replies
    .filter((r) => r.shortcut.toLowerCase().startsWith(q))
    .sort((a, b) => a.shortcut.localeCompare(b.shortcut));
}

export interface QuickReplyPickerProps {
  replies: QuickReply[];
  /** Text typed after the leading `/`. */
  query: string;
  /** Index into the filtered list. */
  activeIndex: number;
  onPick(reply: QuickReply): void;
  onHover?(index: number): void;
  id?: string;
}

/**
 * Presentational `/shortcut` picker. Keyboard handling (↑/↓/Enter/Tab/Escape) lives in the
 * Composer, which keeps focus in the textarea and drives `activeIndex`.
 */
export function QuickReplyPicker({
  replies,
  query,
  activeIndex,
  onPick,
  onHover,
  id,
}: QuickReplyPickerProps) {
  const matches = filterQuickReplies(replies, query);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Quick replies
      </div>
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-sm text-neutral-500 dark:text-neutral-400">
          No quick reply starts with “/{query}”.
        </p>
      ) : (
        <ul
          ref={listRef}
          id={id}
          role="listbox"
          aria-label="Quick replies"
          className="max-h-60 overflow-y-auto overscroll-contain py-1"
        >
          {matches.map((r, i) => (
            <li
              key={r.id}
              role="option"
              data-index={i}
              aria-selected={i === activeIndex}
              // mousedown keeps focus in the textarea
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(r)}
              onMouseEnter={() => onHover?.(i)}
              className={clsx(
                'flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5',
                i === activeIndex
                  ? 'bg-emerald-50 dark:bg-emerald-900/40'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-800',
              )}
            >
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                /{r.shortcut}
              </span>
              <span className="truncate text-sm text-neutral-600 dark:text-neutral-300">
                {truncate(r.body.replace(/\s+/g, ' '), 120)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

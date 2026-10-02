import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { ChatFilters as Filters } from '../api/queries';

export interface ChatFiltersProps {
  value: Filters;
  onChange(next: Filters): void;
}

const tabs: { key: Filters['assigned']; label: string }[] = [
  { key: 'me', label: 'Mine' },
  { key: 'none', label: 'Unassigned' },
  { key: 'any', label: 'All' },
];

const SEARCH_DEBOUNCE_MS = 300;

export function ChatFilters({ value, onChange }: ChatFiltersProps) {
  const [search, setSearch] = useState(value.q ?? '');
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  // Debounce search → filters.
  useEffect(() => {
    const t = setTimeout(() => {
      const { value: v, onChange: cb } = latest.current;
      const q = search.trim() || undefined;
      if (q !== (v.q || undefined)) cb({ ...v, q });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const status = value.status ?? 'open';

  return (
    <div className="space-y-2 border-b border-neutral-200 px-3 pb-2.5 pt-1 dark:border-neutral-800">
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or number"
          aria-label="Search chats"
          className="min-h-11 w-full rounded-lg border border-neutral-200 bg-neutral-100 pl-9 pr-3 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:bg-neutral-900"
        />
      </div>
      <div className="flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Assignment"
          className="flex min-w-0 flex-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={value.assigned === t.key}
              onClick={() => onChange({ ...value, assigned: t.key })}
              className={clsx(
                'min-h-10 flex-1 truncate rounded-md px-2 text-sm font-medium transition-colors',
                value.assigned === t.key
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-50'
                  : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...value, status: status === 'open' ? 'resolved' : 'open' })}
          aria-pressed={status === 'resolved'}
          title={status === 'open' ? 'Showing open chats' : 'Showing resolved chats'}
          className={clsx(
            'min-h-10 shrink-0 rounded-lg border px-3 text-sm font-medium',
            status === 'open'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
          )}
        >
          {status === 'open' ? 'Open' : 'Resolved'}
        </button>
      </div>
    </div>
  );
}

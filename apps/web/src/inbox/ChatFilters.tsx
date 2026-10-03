import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDot } from 'lucide-react';
import type { ChatFilters as Filters } from '../api/queries';
import { SearchField } from '@/components/app/SearchField';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  useEffect(() => setSearch(value.q ?? ''), [value.q]);

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
    <div className="space-y-2 border-b px-3 pb-2.5 pt-1">
      <SearchField
        value={search}
        onChange={setSearch}
        label="Search chats"
        placeholder="Search name or number"
      />
      <div className="flex items-center gap-2">
        <Tabs
          value={value.assigned}
          onValueChange={(v) => onChange({ ...value, assigned: v as Filters['assigned'] })}
          className="min-w-0 flex-1"
        >
          <TabsList aria-label="Assignment" className="h-11! w-full">
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="min-w-0 truncate">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <Tabs
        value={status}
        onValueChange={(v) => onChange({ ...value, status: v as Filters['status'] })}
      >
        <TabsList aria-label="Chat status" className="h-11! w-full">
          <TabsTrigger value="open">
            <CircleDot aria-hidden="true" className="size-4" />
            Open
          </TabsTrigger>
          <TabsTrigger value="resolved">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            Resolved
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

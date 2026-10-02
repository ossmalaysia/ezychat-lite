import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDot, Search } from 'lucide-react';
import type { ChatFilters as Filters } from '../api/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

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
  const open = status === 'open';

  return (
    <div className="space-y-2 border-b px-3 pb-2.5 pt-1">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or number"
          aria-label="Search chats"
          className="h-11 bg-muted pl-9 text-base focus-visible:bg-surface md:text-sm"
        />
      </div>
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
        <Button
          variant="outline"
          size="touch"
          onClick={() => onChange({ ...value, status: open ? 'resolved' : 'open' })}
          aria-pressed={!open}
          title={open ? 'Showing open chats' : 'Showing resolved chats'}
          className={cn('shrink-0', open && 'border-primary/30 bg-accent text-accent-foreground')}
        >
          {open ? (
            <CircleDot className="text-primary" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="text-muted-foreground" aria-hidden="true" />
          )}
          {open ? 'Open' : 'Resolved'}
        </Button>
      </div>
    </div>
  );
}

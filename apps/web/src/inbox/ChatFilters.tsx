import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleDot, Tag, X } from 'lucide-react';
import { useCustomerTags, type ChatFilters as Filters } from '../api/queries';
import { SearchField } from '@/components/app/SearchField';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export interface ChatFiltersProps {
  value: Filters;
  onChange(next: Filters): void;
}

const tabs = [
  { key: 'me', labelKey: 'filters.mine' },
  { key: 'none', labelKey: 'filters.unassigned' },
  { key: 'any', labelKey: 'filters.all' },
] as const satisfies readonly { key: Filters['assigned']; labelKey: string }[];

const SEARCH_DEBOUNCE_MS = 300;

/** Mounted only while the tag popover is open, so tags are fetched on demand. */
function TagOptions({ onPick }: { onPick(tag: string): void }) {
  const { t } = useTranslation('inbox');
  const [search, setSearch] = useState('');
  const tags = useCustomerTags(search.trim());
  return (
    <Command shouldFilter={false} className="bg-popover">
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={t('filters.tagSearch')}
        maxLength={30}
        className="text-base md:text-sm"
      />
      <CommandList label={t('filters.tagLabel')} className="max-h-60 overscroll-contain">
        {tags.data && <CommandEmpty>{t('filters.tagEmpty')}</CommandEmpty>}
        {tags.data?.map((tag) => (
          <CommandItem
            key={tag}
            value={tag}
            onSelect={() => onPick(tag)}
            className="min-h-11 cursor-pointer md:min-h-8"
          >
            <span className="truncate">{tag}</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

export function ChatFilters({ value, onChange }: ChatFiltersProps) {
  const { t } = useTranslation('inbox');
  const [search, setSearch] = useState(value.q ?? '');
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => setSearch(value.q ?? ''), [value.q]);

  // Debounce search → filters.
  useEffect(() => {
    const timer = setTimeout(() => {
      const { value: v, onChange: cb } = latest.current;
      const q = search.trim() || undefined;
      if (q !== (v.q || undefined)) cb({ ...v, q });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const status = value.status ?? 'open';
  const [tagOpen, setTagOpen] = useState(false);

  return (
    <div className="space-y-2 border-b px-3 pb-2.5 pt-1">
      <SearchField
        value={search}
        onChange={setSearch}
        label={t('filters.searchLabel')}
        placeholder={t('filters.searchPlaceholder')}
      />
      <div className="flex items-center gap-2">
        <Tabs
          value={value.assigned}
          onValueChange={(v) => onChange({ ...value, assigned: v as Filters['assigned'] })}
          className="min-w-0 flex-1"
        >
          <TabsList aria-label={t('filters.assignment')} className="h-11! w-full">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="min-w-0 truncate">
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex shrink-0 items-center">
          <Popover open={tagOpen} onOpenChange={setTagOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="touch"
                aria-label={t('filters.tagLabel')}
                title={t('filters.tagLabel')}
                className={cn(
                  'max-w-32 gap-1.5 px-3',
                  value.tag
                    ? 'rounded-r-none border-primary/40 text-primary'
                    : 'text-muted-foreground',
                )}
              >
                <Tag aria-hidden="true" />
                <span className="truncate">{value.tag ?? t('filters.tag')}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 max-w-[calc(100vw-2rem)] p-0">
              <TagOptions
                onPick={(tag) => {
                  setTagOpen(false);
                  onChange({ ...value, tag });
                }}
              />
            </PopoverContent>
          </Popover>
          {value.tag && (
            <Button
              variant="outline"
              size="icon-touch"
              aria-label={t('filters.tagClear')}
              title={t('filters.tagClear')}
              onClick={() => onChange({ ...value, tag: undefined })}
              className="rounded-l-none border-l-0 border-primary/40 text-primary"
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <Tabs
        value={status}
        onValueChange={(v) => onChange({ ...value, status: v as Filters['status'] })}
      >
        <TabsList aria-label={t('filters.status')} className="h-11! w-full">
          <TabsTrigger value="open">
            <CircleDot aria-hidden="true" className="size-4" />
            {t('filters.open')}
          </TabsTrigger>
          <TabsTrigger value="resolved">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {t('filters.resolved')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

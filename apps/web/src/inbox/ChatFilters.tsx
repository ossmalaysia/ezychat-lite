import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleDot, Tag, X } from 'lucide-react';
import type { Inbox } from '@ezychat/shared';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { formatPhone } from '../lib/jid';

export interface ChatFiltersProps {
  value: Filters;
  onChange(next: Filters): void;
  /** The active inboxes the user may open; the inbox filter shows with two or more. */
  inboxes?: readonly Inbox[];
}

const tabs = [
  { key: 'me', labelKey: 'filters.mine' },
  { key: 'none', labelKey: 'filters.unassigned' },
  { key: 'any', labelKey: 'filters.all' },
] as const satisfies readonly { key: Filters['assigned']; labelKey: string }[];

const SEARCH_DEBOUNCE_MS = 300;
const ALL_INBOXES = 'all';

/**
 * One unified list; this narrows it to one inbox. Shown only when the user may open two or more
 * inboxes (an agent with one inbox and Lite never see it).
 */
function InboxFilter({
  value,
  onChange,
  visible,
}: Omit<ChatFiltersProps, 'inboxes'> & { visible: readonly Inbox[] }) {
  const { t } = useTranslation('inbox');
  if (visible.length < 2) return null;
  const selected =
    value.inbox != null && visible.some((i) => i.id === value.inbox)
      ? String(value.inbox)
      : ALL_INBOXES;
  return (
    <Select
      value={selected}
      onValueChange={(v) =>
        onChange({ ...value, inbox: v === ALL_INBOXES ? undefined : Number(v) })
      }
    >
      <SelectTrigger
        aria-label={t('inboxFilter.label')}
        data-testid="inbox-filter"
        className="h-11! w-full bg-surface text-base *:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate md:text-sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={ALL_INBOXES} className="min-h-11 md:min-h-8">
          {t('inboxFilter.all', { total: visible.length })}
        </SelectItem>
        {visible.map((i) => {
          const number = formatPhone({ phone: i.number });
          return (
            <SelectItem key={i.id} value={String(i.id)} className="min-h-11 md:min-h-8">
              {number ? t('inboxFilter.option', { name: i.name, number }) : i.name}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

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

export function ChatFilters({ value, onChange, inboxes = [] }: ChatFiltersProps) {
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
  // A selected tag (+ clear) takes ~170px of the status row: drop the status icons on phones.
  const statusIcon = cn('size-4', value.tag && 'max-sm:hidden');

  return (
    <div className="space-y-2 border-b px-3 pb-2.5 pt-1">
      <SearchField
        value={search}
        onChange={setSearch}
        label={t('filters.searchLabel')}
        placeholder={t('filters.searchPlaceholder')}
      />
      <InboxFilter value={value} onChange={onChange} visible={inboxes} />
      {/* Assignment gets the full row: its labels are the longest (Malay "Belum ditugaskan"). */}
      <Tabs
        value={value.assigned}
        onValueChange={(v) => onChange({ ...value, assigned: v as Filters['assigned'] })}
      >
        <TabsList aria-label={t('filters.assignment')} className="h-11! w-full">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} className="min-w-0">
              {/* The trigger centres its content: truncate an inner span so it ellipsizes. */}
              <span className="min-w-0 truncate">{t(tab.labelKey)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-2">
        <Tabs
          value={status}
          onValueChange={(v) => onChange({ ...value, status: v as Filters['status'] })}
          className="min-w-0 flex-1"
        >
          <TabsList aria-label={t('filters.status')} className="h-11! w-full">
            <TabsTrigger value="open" className="min-w-0">
              <CircleDot aria-hidden="true" className={statusIcon} />
              <span className="min-w-0 truncate">{t('filters.open')}</span>
            </TabsTrigger>
            <TabsTrigger value="resolved" className="min-w-0">
              <CheckCircle2 aria-hidden="true" className={statusIcon} />
              <span className="min-w-0 truncate">{t('filters.resolved')}</span>
            </TabsTrigger>
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
                {/* Narrow below sm so the status tabs keep their room at 360px. */}
                <span className="max-w-20 truncate sm:max-w-none">
                  {value.tag ?? t('filters.tag')}
                </span>
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
    </div>
  );
}

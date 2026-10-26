import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, MessageCircle } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/app';
import { SearchField } from '@/components/app/SearchField';
import { Button } from '@/components/ui/button';
import { useAppLinks } from '@/lib/app-links';
import { cn } from '@/lib/utils';
import { useGoogleCalendar } from '../../api/connectors';
import {
  CONNECTOR_CATEGORIES,
  CONNECTORS,
  connectorStatus,
  type ConnectorCategory,
} from './catalog';
import { ConnectorIcon, ConnectorStatusBadge, VoteButton, useConnectorLinks } from './connector-ui';

const CATEGORY_FILTERS = ['all', ...CONNECTOR_CATEGORIES] as const;

/**
 * Admin → Connectors: a gallery of ready connectors. Each card opens the connector's own page
 * (details, settings, activity), or the page an extension provides. Connected ones come first;
 * search and a category filter narrow the list. The custom MCP connector is greyed out unless an
 * extension (Enterprise) links it.
 */
export function ConnectorsGalleryPage() {
  const { t } = useTranslation('admin');
  const google = useGoogleCalendar();
  const links = useConnectorLinks();
  const request = useAppLinks().connectorRequest;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const q = query.trim().toLocaleLowerCase();
  const rows = CONNECTORS.map((c) => ({
    c,
    href: links[c.id] ?? `/admin/connectors/${c.id}`,
    status: connectorStatus(c, google.data?.state, links[c.id]),
    name: t(`connectors.items.${c.id}.name`),
    short: t(`connectors.items.${c.id}.short`),
  })).filter(
    (r) =>
      (category === 'all' || r.c.category === category) &&
      (!q ||
        r.name.toLocaleLowerCase().includes(q) ||
        r.short.toLocaleLowerCase().includes(q) ||
        r.c.id.includes(q)),
  );
  const mine = rows.filter((r) => r.status === 'connected' || r.status === 'attention');
  const others = rows.filter((r) => !mine.includes(r));

  const grid = (list: typeof rows) => (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((r) => (
        <li
          key={r.c.id}
          className={cn(
            'flex h-full flex-col rounded-xl border',
            r.status === 'enterprise'
              ? 'border-dashed bg-muted/40 text-muted-foreground'
              : 'bg-card',
          )}
          data-testid={`connector-card-${r.c.id}`}
        >
          <Link
            to={r.href}
            className="flex min-h-11 flex-1 items-start gap-3 rounded-xl p-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ConnectorIcon c={r.c} muted={r.status === 'enterprise'} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words">{r.name}</span>
                <ConnectorStatusBadge status={r.status} />
              </span>
              <span className="text-sm text-muted-foreground">{r.short}</span>
              <span className="text-xs text-muted-foreground">
                {t(`connectors.category.${r.c.category}`)}
              </span>
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
          {r.status === 'comingSoon' && request && (
            <div className="px-4 pb-4">
              <VoteButton name={r.name} size="sm" />
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="connectors-gallery">
      <PageHeader
        className="pb-0"
        title={t('connectors.title')}
        description={t('connectors.description')}
      />
      <SearchField
        value={query}
        onChange={setQuery}
        label={t('connectors.searchLabel')}
        placeholder={t('connectors.searchPlaceholder')}
      />
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label={t('connectors.categoryLabel')}
      >
        {CATEGORY_FILTERS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={category === id ? 'default' : 'outline'}
            aria-pressed={category === id}
            className="min-h-9 shrink-0 rounded-full pointer-coarse:min-h-11"
            onClick={() => setCategory(id)}
          >
            {t(`connectors.category.${id}`)}
          </Button>
        ))}
      </div>
      {rows.length === 0 && (
        <EmptyState
          illustration="/illustrations/no-results.png"
          title={t('connectors.noMatch')}
          description={t('connectors.noMatchHint')}
        />
      )}
      {mine.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="connectors-mine">
          <h2 id="connectors-mine" className="text-sm font-medium text-muted-foreground">
            {t('connectors.yours')}
          </h2>
          {grid(mine)}
        </section>
      )}
      {others.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="connectors-all">
          <h2 id="connectors-all" className="text-sm font-medium text-muted-foreground">
            {t('connectors.more')}
          </h2>
          {grid(others)}
        </section>
      )}
      {request && (
        <div className="flex flex-col items-start gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{t('connectors.missing')}</p>
          <Button asChild variant="outline" size="touch" className="shrink-0">
            <a
              href={request(t('connectors.requestMessage'))}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="request-connector"
            >
              <MessageCircle aria-hidden />
              {t('connectors.request')}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

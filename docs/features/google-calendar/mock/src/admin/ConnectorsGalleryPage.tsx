import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, MessageCircle, ThumbsUp } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/app';
import { SearchField } from '@/components/app/SearchField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  listedCategories,
  voteUrl,
  listedConnectors,
  connectorStatus,
  type CatalogConnector,
  type ConnectorCategory,
  type ConnectorStatus,
} from '@/mock/connectorCatalog';
import { useMockEdition } from '@/mock/edition';
import { useGoogleCalendar } from '@/mock/googleCalendar';

/** Status badge used on gallery cards and the detail page header. */
export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation('admin');
  // Mock: catalog keys built from the connector id (the app types them per connector).
  const tc = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const variant =
    status === 'connected'
      ? 'default'
      : status === 'comingSoon' || status === 'enterprise'
        ? 'secondary'
        : 'outline';
  return (
    <Badge
      variant={variant}
      className={status === 'attention' ? 'border-warning text-warning' : undefined}
      data-testid={`connector-status-${status}`}
    >
      {tc(`mockConnectors.status.${status}`)}
    </Badge>
  );
}

/**
 * "Vote for this connector": opens WhatsApp with a ready message to the EzyChat team. Nothing is
 * counted in the app (Lite sends no usage data); the team counts the requests it receives.
 */
export function VoteButton({ name, size = 'touch' }: { name: string; size?: 'sm' | 'touch' }) {
  const { t } = useTranslation('admin');
  return (
    <Button
      asChild
      variant="outline"
      size={size}
      className={cn('self-start', size === 'sm' && 'min-h-9 pointer-coarse:min-h-11')}
    >
      <a
        href={voteUrl(t('mockConnectors.voteMessage', { name }))}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="vote-connector"
      >
        <ThumbsUp aria-hidden />
        {t('mockConnectors.vote')}
        <ExternalLink aria-hidden />
      </a>
    </Button>
  );
}

/** The connector's icon in a calm tile (brand logos are not used in the mock). */
export function ConnectorIcon({
  c,
  size = 'md',
  muted = false,
}: {
  c: CatalogConnector;
  size?: 'md' | 'lg';
  muted?: boolean;
}) {
  const Icon = c.icon;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border bg-muted',
        muted ? 'text-muted-foreground opacity-60' : 'text-foreground',
        size === 'lg' ? 'size-14' : 'size-11',
      )}
      aria-hidden
    >
      <Icon className={size === 'lg' ? 'size-7' : 'size-5'} />
    </span>
  );
}

/**
 * Proposed (google-calendar): Admin → Connectors, a gallery of ready connectors. Each card opens the
 * connector's own page (details, settings, activity). Connected ones come first; search and a
 * category filter narrow the list. Enterprise-only connectors show in Lite with an Enterprise badge.
 */
export function ConnectorsGalleryPage() {
  const { t } = useTranslation('admin');
  // Mock: catalog keys built from the connector id (the app types them per connector).
  const tc = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const edition = useMockEdition();
  const google = useGoogleCalendar();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const q = query.trim().toLowerCase();
  const rows = listedConnectors(edition)
    .map((c) => ({
      c,
      status: connectorStatus(c, edition, google.data?.state),
      name: tc(`mockConnectors.items.${c.id}.name`),
      short: tc(`mockConnectors.items.${c.id}.short`),
    }))
    .filter(
      (r) =>
        (category === 'all' || r.c.category === category) &&
        (!q || r.name.toLowerCase().includes(q) || r.short.toLowerCase().includes(q)),
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
            // Lite: Enterprise-only connectors are greyed out; the page still explains them.
            r.status === 'enterprise'
              ? 'border-dashed bg-muted/40 text-muted-foreground'
              : 'bg-card',
          )}
          data-testid={`connector-card-${r.c.id}`}
        >
          <Link
            to={`/admin/connectors/${r.c.id}`}
            className="flex min-h-11 flex-1 items-start gap-3 rounded-xl p-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ConnectorIcon c={r.c} muted={r.status === 'enterprise'} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words">{r.name}</span>
                <ConnectorStatusBadge status={r.status} />
                {r.status === 'enterprise' && !r.c.available && (
                  <ConnectorStatusBadge status="comingSoon" />
                )}
              </span>
              <span className="text-sm text-muted-foreground">{r.short}</span>
              <span className="text-xs text-muted-foreground">
                {tc(`mockConnectors.category.${r.c.category}`)}
              </span>
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
          {!r.c.available && (
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
        title={t('mockConnectors.title')}
        description={t('mockConnectors.description')}
      />
      <SearchField
        value={query}
        onChange={setQuery}
        label={t('mockConnectors.searchLabel')}
        placeholder={t('mockConnectors.searchPlaceholder')}
      />
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label={t('mockConnectors.categoryLabel')}
      >
        {(['all', ...listedCategories(edition)] as const).map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={category === id ? 'default' : 'outline'}
            aria-pressed={category === id}
            className="min-h-9 shrink-0 rounded-full pointer-coarse:min-h-11"
            onClick={() => setCategory(id)}
          >
            {tc(`mockConnectors.category.${id}`)}
          </Button>
        ))}
      </div>
      {rows.length === 0 && (
        <EmptyState
          illustration="/illustrations/no-results.png"
          title={t('mockConnectors.noMatch')}
          description={t('mockConnectors.noMatchHint')}
        />
      )}
      {mine.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="connectors-mine">
          <h2 id="connectors-mine" className="text-sm font-medium text-muted-foreground">
            {t('mockConnectors.yours')}
          </h2>
          {grid(mine)}
        </section>
      )}
      {others.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="connectors-all">
          <h2 id="connectors-all" className="text-sm font-medium text-muted-foreground">
            {t('mockConnectors.more')}
          </h2>
          {grid(others)}
        </section>
      )}
      <div className="flex flex-col items-start gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t('mockConnectors.missing')}</p>
        <Button asChild variant="outline" size="touch" className="shrink-0">
          <a
            href={voteUrl(t('mockConnectors.requestMessage'))}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="request-connector"
          >
            <MessageCircle aria-hidden />
            {t('mockConnectors.request')}
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </div>
    </div>
  );
}

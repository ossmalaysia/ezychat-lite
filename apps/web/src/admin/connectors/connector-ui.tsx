import { useTranslation } from 'react-i18next';
import { ExternalLink, ThumbsUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppLinks } from '@/lib/app-links';
import { cn } from '@/lib/utils';
import { useWebExtensions } from '../../extensions';
import type { CatalogConnector, ConnectorStatus } from './catalog';

/** Connector pages that web extensions provide, by catalog id (the first extension wins). */
export function useConnectorLinks(): Partial<Record<string, string>> {
  const extensions = useWebExtensions();
  const links: Partial<Record<string, string>> = {};
  for (const ext of extensions)
    for (const [id, href] of Object.entries(ext.connectorLinks ?? {}))
      if (href && links[id] === undefined) links[id] = href;
  return links;
}

/** Status badge on gallery cards and the connector page header (none for `linked`). */
export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation('admin');
  if (status === 'linked') return null;
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
      {t(`connectors.status.${status}`)}
    </Badge>
  );
}

/** The connector's icon in a calm tile (no brand logos). */
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
 * "Vote for this connector": opens a ready message to the EzyChat team (WhatsApp in Lite). Nothing
 * is counted in the app (no tracking in Lite); hidden when the product sets the link to null.
 */
export function VoteButton({ name, size = 'touch' }: { name: string; size?: 'sm' | 'touch' }) {
  const { t } = useTranslation('admin');
  const request = useAppLinks().connectorRequest;
  if (!request) return null;
  return (
    <Button
      asChild
      variant="outline"
      size={size}
      className={cn('self-start', size === 'sm' && 'min-h-9 pointer-coarse:min-h-11')}
    >
      <a
        href={request(t('connectors.voteMessage', { name }))}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="vote-connector"
      >
        <ThumbsUp aria-hidden />
        {t('connectors.vote')}
        <ExternalLink aria-hidden />
      </a>
    </Button>
  );
}

/** "Open Google Calendar" / "Open in Google Calendar": opens Google in the browser (outside the app). */
export function GoogleCalendarLink({
  href,
  label,
  variant = 'outline',
}: {
  href: string;
  label: string;
  variant?: 'outline' | 'ghost';
}) {
  return (
    <Button
      asChild
      variant={variant}
      size="sm"
      className="min-h-9 self-start pointer-coarse:min-h-11"
    >
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalLink aria-hidden />
      </a>
    </Button>
  );
}

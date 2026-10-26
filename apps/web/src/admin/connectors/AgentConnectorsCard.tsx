import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight, Plug } from 'lucide-react';
import { useBookingSettings, useGoogleCalendar } from '../../api/connectors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { findConnector } from './catalog';
import { ConnectorIcon, ConnectorStatusBadge } from './connector-ui';

/**
 * Agent page → Connectors: one summary row per connected connector (what this agent may do there)
 * that opens the connector's Settings tab for this agent. Settings live on the connector's page.
 */
export function AgentConnectorsCard({
  agentId,
  name,
}: Readonly<{ agentId: number; name: string }>) {
  const { t } = useTranslation('admin');
  const google = useGoogleCalendar();
  const state = google.data?.state;
  const connected = state === 'connected' || state === 'expired' || state === 'unavailable';
  const booking = useBookingSettings(agentId, connected);
  const gc = findConnector('google-calendar')!;
  const summary = !booking.data
    ? null
    : !booking.data.checkFree
      ? t('connectors.agentCard.off')
      : booking.data.book
        ? t('connectors.agentCard.checkAndBook')
        : t('connectors.agentCard.checkOnly');
  return (
    <Card className="gap-4" data-testid="agent-connectors">
      <CardHeader>
        <CardTitle>{t('connectors.title')}</CardTitle>
        <CardDescription>{t('connectors.agentCard.description', { name })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {connected ? (
          <Link
            to={`/admin/connectors/google-calendar?tab=settings&agent=${agentId}`}
            className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-3 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-testid="agent-connector-google-calendar"
          >
            <ConnectorIcon c={gc} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {t('connectors.items.google-calendar.name')}
                {state !== 'connected' && <ConnectorStatusBadge status="attention" />}
              </span>
              {summary && <span className="text-sm text-muted-foreground">{summary}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{t('connectors.agentCard.none')}</p>
        )}
        <Button asChild variant="outline" size="touch" className="self-start">
          <Link to="/admin/connectors">
            <Plug aria-hidden />
            {t('connectors.agentCard.browse')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

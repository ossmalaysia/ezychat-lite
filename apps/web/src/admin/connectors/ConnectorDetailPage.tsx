import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CalendarCheck,
  CalendarSearch,
  MessageSquare,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import type { CalendarActivity, CalendarBooking } from '@ezychat/shared';
import { useCalendarActivity, useCalendarBookings, useGoogleCalendar } from '../../api/connectors';
import { encodeJid } from '../../lib/jid';
import { EmptyState } from '@/components/app';
import { UpgradeButton } from '@/components/app/UpgradeEnterprise';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelative, formatTimeRange } from '@/lib/format';
import { ErrorState, ListSkeleton } from '../adminUi';
import { AgentPicker } from './AgentPicker';
import { BookingSettingsCard } from './BookingSettingsCard';
import { connectorStatus, findConnector, type CatalogConnector } from './catalog';
import {
  ConnectorBreadcrumb,
  ConnectorIcon,
  ConnectorStatusBadge,
  GoogleCalendarLink,
  useConnectorLinks,
} from './connector-ui';
import { GoogleCalendarAccountCard } from './GoogleCalendarAccountCard';
import { ListConnectorPage } from './PartnerConnectorPage';

const TABS = ['overview', 'settings', 'activity', 'bookings'] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: string | null): value is Tab =>
  (TABS as readonly string[]).includes(value ?? '');

/**
 * `/admin/connectors/:id`: one page per connector. The app's own connectors come first: Google
 * Calendar has Overview (what it does, the Google account, your data), Settings (per AI agent),
 * Activity and Bookings tabs (`?tab=`, `&agent=`); the custom connector needs Enterprise. Every
 * other page is built from the connector's entry in the connector list. A connector an extension
 * provides opens the extension's page.
 */
export function ConnectorDetailPage() {
  const { id } = useParams();
  const c = findConnector(id);
  if (!c) return <ListConnectorPage id={id ?? ''} />;
  return <AppConnectorPage c={c} />;
}

function AppConnectorPage({ c }: { c: CatalogConnector }) {
  const { t } = useTranslation('admin');
  const links = useConnectorLinks();
  const google = useGoogleCalendar(c.id === 'google-calendar');
  const link = links[c.id];
  if (link) return <Navigate to={link} replace />;
  const status = connectorStatus(c, google.data?.state, undefined);
  const name = t(`connectors.items.${c.id}.name`);

  return (
    <div className="flex flex-col gap-4" data-testid={`connector-page-${c.id}`}>
      <ConnectorBreadcrumb name={name} />
      <div className="flex items-start gap-4">
        <ConnectorIcon c={c} size="lg" muted={status === 'enterprise'} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight break-words">{name}</h1>
            <ConnectorStatusBadge status={status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {t(c.edition === 'core' ? 'connectors.byCore' : 'connectors.byEnterprise')} ·{' '}
            {t(`connectors.category.${c.category}`)}
          </p>
        </div>
      </div>

      {c.id === 'google-calendar' ? (
        <GoogleCalendarTabs c={c} />
      ) : (
        <div className="flex flex-col gap-4">
          {status === 'enterprise' && (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">{t('connectors.enterpriseOnly')}</p>
              <UpgradeButton className="shrink-0 self-start sm:self-auto" />
            </div>
          )}
          <About c={c} />
          <Privacy c={c} />
          <Button asChild variant="outline" size="touch" className="self-start">
            <Link to="/admin/connectors">{t('connectors.backToGallery')}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function GoogleCalendarTabs({ c }: { c: CatalogConnector }) {
  const { t } = useTranslation('admin');
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'overview';
  const setTab = (next: string) =>
    setParams(
      (p) => {
        p.set('tab', next);
        return p;
      },
      { replace: true },
    );
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="-mx-4 scroll-px-4 overflow-x-auto px-4 pb-1">
        <TabsList variant="line" className="w-max justify-start">
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id} className="min-h-11 flex-none px-3 md:min-h-9">
              {t(`connectors.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="overview" className="flex flex-col gap-4">
        <About c={c} />
        <GoogleCalendarAccountCard onOpenSettings={() => setTab('settings')} />
        <Privacy c={c} />
      </TabsContent>
      <TabsContent value="settings" className="flex flex-col gap-4">
        <AgentSettings onConnect={() => setTab('overview')} />
      </TabsContent>
      <TabsContent value="activity" className="flex flex-col gap-4">
        <Activity />
      </TabsContent>
      <TabsContent value="bookings" className="flex flex-col gap-4">
        <Bookings />
      </TabsContent>
    </Tabs>
  );
}

/** What the connector does and what the AI may do with it (look-ups and actions). */
function About({ c }: { c: CatalogConnector }) {
  const { t } = useTranslation('admin');
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t('connectors.aboutTitle')}</CardTitle>
        <CardDescription>{t(`connectors.items.${c.id}.long`)}</CardDescription>
      </CardHeader>
      {c.tools.length > 0 && (
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('connectors.aiCan')}</p>
          <ul className="flex flex-col divide-y rounded-lg border">
            {c.tools.map((tool) => (
              <li key={tool.key} className="flex flex-col gap-1 px-3 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`connectors.tools.${tool.key}`)}</span>
                  <Badge variant="secondary">
                    {t(tool.access === 'read' ? 'connectors.lookUp' : 'connectors.changes')}
                  </Badge>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`connectors.tools.${tool.key}Hint`)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t('connectors.switchNote')}</p>
        </CardContent>
      )}
    </Card>
  );
}

function Privacy({ c }: { c: CatalogConnector }) {
  const { t } = useTranslation('admin');
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{t('connectors.privacyTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t(`connectors.items.${c.id}.privacy`)}</p>
      </CardContent>
    </Card>
  );
}

/** Settings tab: one AI agent at a time (`&agent=<id>` picks it; a picker with 2+ agents). */
function AgentSettings({ onConnect }: { onConnect: () => void }) {
  const google = useGoogleCalendar();
  if (google.isPending) return <ListSkeleton rows={3} />;
  if (google.error)
    return <ErrorState error={google.error} onRetry={() => void google.refetch()} />;
  return (
    <AgentPicker
      render={(agent) => (
        <BookingSettingsCard
          key={agent.id}
          agentId={agent.id}
          name={agent.displayName}
          status={google.data}
          onConnect={onConnect}
        />
      )}
    />
  );
}

const ACTIVITY_ICON = {
  booked: CalendarCheck,
  checked: CalendarSearch,
  handed_over: UserRound,
  failed: TriangleAlert,
} as const;

/** Activity tab: what the AI checked and booked (who and when, never the chat text). */
function Activity() {
  const { t } = useTranslation('admin');
  const query = useCalendarActivity();
  if (query.isPending) return <ListSkeleton rows={3} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const rows = query.data.activity;
  if (rows.length === 0)
    return (
      <EmptyState
        title={t('connectors.activityEmpty')}
        description={t('connectors.activityHint')}
      />
    );
  const line = (r: CalendarActivity) => {
    const when = r.start && r.end ? formatTimeRange(r.start, r.end) : '';
    if (r.kind === 'booked' && when)
      return t('connectors.act.booked', { agent: r.agentName, customer: r.customer, when });
    if (r.kind === 'booked')
      return t('connectors.act.bookedNoTime', { agent: r.agentName, customer: r.customer });
    return t(`connectors.act.${r.kind}`, { agent: r.agentName, customer: r.customer });
  };
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{t('connectors.activityTitle')}</CardTitle>
        <CardDescription>{t('connectors.activityHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y" data-testid="calendar-activity">
          {rows.map((r) => {
            const Icon = ACTIVITY_ICON[r.kind];
            return (
              <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm break-words">{line(r)}</span>
                  <span className="text-xs text-muted-foreground">{formatRelative(r.at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Test ids of the two lists. */
const BOOKING_LISTS = { upcoming: 'bookings-upcoming', past: 'bookings-past' } as const;

/**
 * Bookings tab: the events the AI added (EzyChat's own records, no Google call), upcoming first,
 * with links to the chat and to the event in Google Calendar.
 */
function Bookings() {
  const { t } = useTranslation('admin');
  const query = useCalendarBookings();
  if (query.isPending) return <ListSkeleton rows={3} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { upcoming, past, calendarUrl } = query.data;
  const open = calendarUrl && (
    <GoogleCalendarLink href={calendarUrl} label={t('connectors.bookings.openCalendar')} />
  );
  if (upcoming.length === 0 && past.length === 0)
    return (
      <EmptyState
        title={t('connectors.bookings.empty')}
        description={t('connectors.bookings.emptyHint')}
        action={open || undefined}
      />
    );
  const list = (rows: CalendarBooking[], testId: string) => (
    <ul className="flex flex-col divide-y rounded-lg border" data-testid={testId}>
      {rows.map((b) => (
        <li key={b.id} className="flex flex-col gap-2 px-3 py-3">
          <span className="flex items-start gap-3">
            <CalendarCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium break-words">
                {formatTimeRange(b.start, b.end)}
              </span>
              <span className="text-sm break-words">
                {b.customer || t('connectors.bookings.unknownCustomer')}
              </span>
              {b.agentName && (
                <span className="text-xs text-muted-foreground">
                  {t('connectors.bookings.by', { agent: b.agentName })}
                </span>
              )}
            </span>
          </span>
          <span className="flex flex-wrap gap-2 pl-7">
            <Button asChild variant="outline" size="sm" className="min-h-9 pointer-coarse:min-h-11">
              <Link to={`/chats/${encodeJid(b.chatJid)}`}>
                <MessageSquare aria-hidden />
                {t('connectors.bookings.openChat')}
              </Link>
            </Button>
            <GoogleCalendarLink href={b.eventUrl} label={t('connectors.bookings.openEvent')} />
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t('connectors.bookings.title')}</CardTitle>
        <CardDescription>{t('connectors.bookings.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open}
        <section className="flex flex-col gap-2" aria-labelledby="bookings-upcoming">
          <h3 id="bookings-upcoming" className="text-sm font-medium">
            {t('connectors.bookings.upcoming')}
          </h3>
          {upcoming.length > 0 ? (
            list(upcoming, BOOKING_LISTS.upcoming)
          ) : (
            <p className="text-sm text-muted-foreground">{t('connectors.bookings.noneUpcoming')}</p>
          )}
        </section>
        {past.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="bookings-past">
            <h3 id="bookings-past" className="text-sm font-medium">
              {t('connectors.bookings.past')}
            </h3>
            {list(past, BOOKING_LISTS.past)}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

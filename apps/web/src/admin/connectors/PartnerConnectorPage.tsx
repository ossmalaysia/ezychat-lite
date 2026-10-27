import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ExternalLink, Search, ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  connectorText,
  type ConnectorActivity,
  type ConnectorEntry,
  type GalleryConnector,
} from '@ezychat/shared';
import { useConnectorActivity, useConnectorGallery } from '../../api/connector-list';
import { Banner, EmptyState } from '@/components/app';
import { UpgradeButton } from '@/components/app/UpgradeEnterprise';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelative } from '@/lib/format';
import { ErrorState, ListSkeleton } from '../adminUi';
import { AgentPicker } from './AgentPicker';
import { LIST_CATEGORY, type ConnectorStatus } from './catalog';
import {
  BetaBadge,
  ConnectorBreadcrumb,
  ConnectorIcon,
  ConnectorNotice,
  ConnectorStatusBadge,
  VoteButton,
} from './connector-ui';
import { entryIcon, isLinked, listStatus } from './list';
import { PartnerConnectionCard } from './PartnerConnectionCard';
import { PartnerSettingsCard } from './PartnerSettingsCard';

const TABS = ['overview', 'settings', 'activity'] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: string | null): value is Tab =>
  (TABS as readonly string[]).includes(value ?? '');

/**
 * `/admin/connectors/:id` for a connector from the connector list: a partner (MCP) connector gets
 * Overview, Settings per AI agent and Activity; a coming-soon one its texts and Vote; one that
 * needs a newer EzyChat or Enterprise its texts only.
 */
export function ListConnectorPage({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const list = useConnectorGallery();
  if (list.isPending) return <ListSkeleton rows={4} />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const g = list.data.connectors.find((c) => c.entry.id === id);
  if (!g || g.entry.kind === 'builtin' || (g.delisted && !isLinked(g.connection)))
    return (
      <EmptyState
        illustration="/illustrations/no-results.png"
        title={t('connectors.notFound')}
        action={
          <Button asChild size="touch">
            <Link to="/admin/connectors">{t('connectors.backToGallery')}</Link>
          </Button>
        }
      />
    );
  const status = listStatus(g);
  if (g.entry.kind === 'mcp' && status !== 'needsUpdate' && status !== 'enterprise')
    return <PartnerConnectorPage g={g} status={status} />;
  return <EntryInfoPage g={g} status={status} appVersion={list.data.status.appVersion} />;
}

/** The header of a page built from a list entry: icon, name, status, publisher and website. */
function EntryHeader({ entry, status }: { entry: ConnectorEntry; status: ConnectorStatus }) {
  const { t } = useTranslation('admin');
  const greyed = status === 'enterprise' || status === 'needsUpdate';
  const category = t(`connectors.category.${LIST_CATEGORY[entry.category]}`);
  return (
    <div className="flex items-start gap-4">
      <ConnectorIcon c={entryIcon(entry)} size="lg" muted={greyed} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight break-words">{entry.name}</h1>
          <ConnectorStatusBadge status={status} />
          <BetaBadge show={entry.stage === 'beta'} />
        </div>
        <p className="text-sm break-words text-muted-foreground">
          {entry.publisher
            ? t('connectors.list.byPublisher', { publisher: entry.publisher, category })
            : category}
        </p>
        {entry.homepage && (
          <a
            href={entry.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-primary underline-offset-4 hover:underline md:min-h-0"
            data-testid="publisher-homepage"
          >
            {t('connectors.partner.website', { publisher: entry.publisher ?? entry.name })}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

/** What it does and what the AI can do: the entry's texts in the UI language. */
function EntryAbout({ entry }: { entry: ConnectorEntry }) {
  const { t, i18n } = useTranslation('admin');
  const tools = entry.tools ?? [];
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t('connectors.aboutTitle')}</CardTitle>
        <CardDescription className="break-words whitespace-pre-line">
          {connectorText(entry.description, i18n.language)}
        </CardDescription>
      </CardHeader>
      {tools.length > 0 && (
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('connectors.aiCan')}</p>
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="entry-tools">
            {tools.map((tool) => (
              <li key={tool.name} className="flex flex-col gap-1 px-3 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">
                    {connectorText(tool.title, i18n.language)}
                  </span>
                  <Badge variant="secondary">
                    {t(tool.access === 'read' ? 'connectors.lookUp' : 'connectors.changes')}
                  </Badge>
                </span>
                <span className="text-sm break-words text-muted-foreground">
                  {connectorText(tool.description, i18n.language)}
                </span>
              </li>
            ))}
          </ul>
          {tools.some((tool) => tool.access === 'write') && (
            <p className="text-sm text-muted-foreground">{t('connectors.switchNote')}</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/** Your data: the entry's privacy line, plus the technical details behind a button. */
function EntryPrivacy({ entry }: { entry: ConnectorEntry }) {
  const { t, i18n } = useTranslation('admin');
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  if (!entry.privacy && !entry.mcp) return null;
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{t('connectors.privacyTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {entry.privacy && (
          <p className="text-sm break-words text-muted-foreground">
            {connectorText(entry.privacy, i18n.language)}
          </p>
        )}
        {entry.mcp && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-9 self-start px-2 pointer-coarse:min-h-11"
              aria-expanded={details}
              aria-controls={detailsId}
              onClick={() => setDetails((v) => !v)}
            >
              {details ? t('connectors.partner.hideDetails') : t('connectors.partner.showDetails')}
            </Button>
            {details && (
              <dl
                id={detailsId}
                className="grid gap-x-4 gap-y-2 rounded-lg border px-3 py-3 text-sm sm:grid-cols-[auto_1fr]"
                data-testid="developer-details"
              >
                <dt className="text-muted-foreground">{t('connectors.partner.detail.server')}</dt>
                <dd className="font-mono text-xs break-all">{entry.mcp.url}</dd>
                <dt className="text-muted-foreground">{t('connectors.partner.detail.signIn')}</dt>
                <dd>{t(`connectors.partner.signInType.${entry.auth?.type ?? 'none'}`)}</dd>
                <dt className="text-muted-foreground">{t('connectors.partner.detail.entry')}</dt>
                <dd className="break-all">
                  {t('connectors.partner.detail.entryValue', {
                    id: entry.id,
                    schema: entry.schemaVersion,
                  })}
                </dd>
              </dl>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A coming-soon entry, or one that needs a newer EzyChat or Enterprise: its texts only. */
function EntryInfoPage({
  g,
  status,
  appVersion,
}: {
  g: GalleryConnector;
  status: ConnectorStatus;
  appVersion: string;
}) {
  const { t } = useTranslation('admin');
  const { entry } = g;
  return (
    <div className="flex flex-col gap-4" data-testid={`connector-page-${entry.id}`}>
      <ConnectorBreadcrumb name={entry.name} />
      <EntryHeader entry={entry} status={status} />
      {status === 'enterprise' && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{t('connectors.enterpriseOnly')}</p>
          <UpgradeButton className="shrink-0 self-start sm:self-auto" />
        </div>
      )}
      {status === 'needsUpdate' && (
        <Banner tone="info" title={t('connectors.partner.needsUpdateTitle')}>
          <span data-testid="needs-update">
            {t('connectors.partner.needsUpdateBody', {
              need: entry.minAppVersion,
              have: appVersion,
            })}
          </span>
        </Banner>
      )}
      {status === 'comingSoon' && (
        <Banner tone="info" title={t('connectors.comingSoonTitle')}>
          <span className="flex flex-col items-start gap-2">
            {t('connectors.comingSoonBody')}
            <VoteButton name={entry.name} />
          </span>
        </Banner>
      )}
      <EntryAbout entry={entry} />
      <EntryPrivacy entry={entry} />
      <Button asChild variant="outline" size="touch" className="self-start">
        <Link to="/admin/connectors">{t('connectors.backToGallery')}</Link>
      </Button>
    </div>
  );
}

/**
 * The page of a partner (MCP) connector, built from its list entry. EzyChat connects from this
 * computer straight to the partner's MCP server: Overview (what it does, the connection, your
 * data), Settings per AI agent (the entry's form, one switch per tool, the rules the AI always
 * follows) and Activity. A connector removed from the list keeps working, with a warning.
 */
function PartnerConnectorPage({ g, status }: { g: GalleryConnector; status: ConnectorStatus }) {
  const { t } = useTranslation('admin');
  const [params, setParams] = useSearchParams();
  const { entry } = g;
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
    <div className="flex flex-col gap-4" data-testid={`connector-page-${entry.id}`}>
      <ConnectorBreadcrumb name={entry.name} />
      <EntryHeader entry={entry} status={status} />
      {g.delisted && (
        <Banner tone="warning" title={t('connectors.partner.delistedTitle')}>
          <span data-testid="delisted-note">{t('connectors.partner.delistedBody')}</span>
        </Banner>
      )}
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
          <EntryAbout entry={entry} />
          <ConnectorNotice entry={entry} />
          <PartnerConnectionCard g={g} onOpenSettings={() => setTab('settings')} />
          <EntryPrivacy entry={entry} />
        </TabsContent>
        <TabsContent value="settings" className="flex flex-col gap-4">
          {isLinked(g.connection) ? (
            <AgentPicker
              render={(agent) => (
                <PartnerSettingsCard
                  key={`${entry.id}-${agent.id}`}
                  entry={entry}
                  agentId={agent.id}
                  agentName={agent.displayName}
                />
              )}
            />
          ) : (
            <EmptyState
              title={t('connectors.partner.connectFirst', { name: entry.name })}
              description={t('connectors.partner.connectFirstHint')}
              action={
                <Button size="touch" onClick={() => setTab('overview')}>
                  {t('connectors.partner.goToOverview')}
                </Button>
              }
            />
          )}
        </TabsContent>
        <TabsContent value="activity" className="flex flex-col gap-4">
          <PartnerActivity entry={entry} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const ACTIVITY_ICON = {
  checked: Search,
  done: CheckCircle2,
  refused: ShieldAlert,
  failed: TriangleAlert,
} as const;

const ACTIVITY_ICON_CLASS = {
  checked: 'text-muted-foreground',
  done: 'text-muted-foreground',
  refused: 'text-warning',
  failed: 'text-danger',
} as const;

const ACTIVITY_BADGE_CLASS = {
  checked: undefined,
  done: undefined,
  refused: 'border-warning text-warning',
  failed: 'border-danger text-danger',
} as const;

/** Activity: tool calls (looked up, done, refused with the reason, failed), never chat text. */
function PartnerActivity({ entry }: { entry: ConnectorEntry }) {
  const { t, i18n } = useTranslation('admin');
  const query = useConnectorActivity(entry.id);
  if (query.isPending) return <ListSkeleton rows={3} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const rows = query.data.activity;
  if (rows.length === 0)
    return (
      <EmptyState
        title={t('connectors.activityEmpty')}
        description={t('connectors.partner.activityHint', { name: entry.name })}
      />
    );
  const toolTitle = (name: string) => {
    const tool = entry.tools?.find((x) => x.name === name);
    return tool ? connectorText(tool.title, i18n.language) : name;
  };
  const publisher = entry.publisher ?? entry.name;
  const row = (r: ConnectorActivity) => {
    const Icon = ACTIVITY_ICON[r.kind];
    return (
      <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0">
        <Icon className={`mt-0.5 size-4 shrink-0 ${ACTIVITY_ICON_CLASS[r.kind]}`} aria-hidden />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium break-words">
              {t('connectors.partner.actLine', { tool: toolTitle(r.tool), customer: r.customer })}
            </span>
            <Badge
              variant={r.kind === 'done' ? 'default' : 'outline'}
              className={ACTIVITY_BADGE_CLASS[r.kind]}
            >
              {t(`connectors.partner.act.${r.kind}`)}
            </Badge>
          </span>
          {r.reason && (
            <span className="text-sm break-words text-muted-foreground">
              {t(`connectors.partner.reason.${r.reason}`, { publisher })}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {t('connectors.partner.actBy', { agent: r.agentName, when: formatRelative(r.at) })}
          </span>
        </span>
      </li>
    );
  };
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{t('connectors.activityTitle')}</CardTitle>
        <CardDescription>
          {t('connectors.partner.activityHint', { name: entry.name })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y" data-testid="partner-activity">
          {rows.map(row)}
        </ul>
      </CardContent>
    </Card>
  );
}

import { ExtensionBannerSlot } from '@/access/BannerSlot';
import { useEffect } from 'react';
import {
  BarChart3,
  ChevronRight,
  Inbox,
  Loader2,
  MessageSquareText,
  Plug,
  Puzzle,
  ScrollText,
  Settings,
  ShieldAlert,
  Smartphone,
  Globe,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAiAgents } from '../api/ai';
import { useInboxes } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { cn } from '@/lib/utils';
import { useAppVersion } from '@/lib/version';
import { useMediaQuery } from '@/lib/use-media-query';
import { reportClientError } from '@/lib/error-reporter';
import { AppCredits } from '@/components/app';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import {
  extensionPath,
  extensionRoutes,
  extensionSectionOf,
  useExtensionTranslation,
  useWebExtensions,
  type WebExtension,
  type WebExtensionAdminSection,
  type WebExtensionNavItem,
} from '../extensions';
import { PhoneBar } from '../nav/PhoneBar';
import { useNumberAttention } from '../nav/attention';
import { AiMemberPage } from './AiMemberPage';
import { AuditPage } from './AuditPage';
import { ConnectorDetailPage } from './connectors/ConnectorDetailPage';
import { ConnectorsGalleryPage } from './connectors/ConnectorsGalleryPage';
import { ReportsPage } from './ReportsPage';
import { SafetyPage } from './SafetyPage';
import { ListSkeleton } from './adminUi';
import { InboxesPage } from './InboxesPage';
import { MembersPage } from './MembersPage';
import { QuickRepliesPage } from './QuickRepliesPage';
import { SettingsPage } from './SettingsPage';
import { TunnelPage } from './TunnelPage';
import { WhatsAppPage } from './WhatsAppPage';
import { LiteImportPage } from '../lite-import/LiteImportPage';

/**
 * Every core admin section. `labelKey` is a translation key in the `admin` namespace. WhatsApp and
 * Inboxes never show together: see `visibleAdminNav`.
 */
export const ADMIN_NAV = [
  // First: the page an owner opens most (design: docs/features/reports/design.md).
  { to: 'reports', labelKey: 'nav.reports', icon: BarChart3 },
  // WhatsApp Safety: next to Reports, the page an owner opens after an alert.
  { to: 'safety', labelKey: 'nav.safety', icon: ShieldAlert },
  { to: 'members', labelKey: 'nav.members', icon: Users },
  { to: 'quick-replies', labelKey: 'nav.quickReplies', icon: MessageSquareText },
  { to: 'connectors', labelKey: 'nav.connectors', icon: Plug },
  { to: 'whatsapp', labelKey: 'nav.whatsapp', icon: Smartphone },
  { to: 'inboxes', labelKey: 'inboxes.title', icon: Inbox },
  { to: 'tunnel', labelKey: 'nav.tunnel', icon: Globe },
  // "App settings", so it does not repeat the name of the whole area, Settings.
  { to: 'settings', labelKey: 'nav.settings', icon: Settings },
  { to: 'audit', labelKey: 'nav.audit', icon: ScrollText },
] as const satisfies readonly { to: string; labelKey: string; icon: LucideIcon }[];

export type AdminNavItem = (typeof ADMIN_NAV)[number];

/**
 * The sections in the nav: **Inboxes** replaces **WhatsApp** only in an edition that allows more than
 * one WhatsApp number (Lite allows one, so it keeps WhatsApp).
 */
export function visibleAdminNav(multiInbox: boolean): AdminNavItem[] {
  return ADMIN_NAV.filter((n) => n.to !== (multiInbox ? 'whatsapp' : 'inboxes'));
}

/**
 * App navigation (docs/features/app-navigation/design.md): Reports and Members are places of the rail (full width,
 * no side menu); every other admin page is under Settings.
 */
const RAIL_PLACES: ReadonlySet<string> = new Set(['reports', 'members']);
const isNumbers = (to: string) => to === 'whatsapp' || to === 'inboxes';

/** True when the edition allows several WhatsApp numbers; false (Lite) until the server says so. */
function useMultiInbox(): { multiInbox: boolean; isPending: boolean } {
  const inboxes = useInboxes();
  return { multiInbox: (inboxes.data?.maxInboxes ?? 1) > 1, isPending: inboxes.isPending };
}

/** `/admin/whatsapp`: the WhatsApp page, or Inboxes when the edition has several numbers. */
function WhatsAppRoute() {
  const { multiInbox } = useMultiInbox();
  return multiInbox ? <Navigate to="/admin/inboxes" replace /> : <WhatsAppPage />;
}

/** `/admin/inboxes`: only with several numbers; Lite goes back to its WhatsApp page. */
function InboxesRoute() {
  const { multiInbox, isPending } = useMultiInbox();
  if (isPending) return <ListSkeleton rows={2} />;
  return multiInbox ? <InboxesPage /> : <Navigate to="/admin/whatsapp" replace />;
}

/**
 * `/admin/members/ai`: Lite opens its one agent (or a new one); an edition with several agents lists
 * them on Members.
 */
function AiAgentIndexRoute() {
  const agents = useAiAgents();
  if (agents.isPending) return <ListSkeleton rows={2} />;
  const data = agents.data;
  if (!data || data.maxAgents > 1) return <Navigate to="/admin/members" replace />;
  const first = data.agents[0];
  return (
    <Navigate to={first ? `/admin/members/ai/${first.id}` : '/admin/members/ai/new'} replace />
  );
}

/** `/admin/members/ai/:agentId`: a positive id only; anything else goes back to Members. */
function AiAgentRoute() {
  const { agentId = '' } = useParams();
  return /^[1-9]\d{0,9}$/.test(agentId) ? (
    <AiMemberPage />
  ) : (
    <Navigate to="/admin/members" replace />
  );
}

interface ExtensionNavLink {
  key: string;
  href: string;
  /** Translation key in the `common` namespace (extension catalogs live there). */
  labelKey: string;
  icon: NonNullable<WebExtensionNavItem['icon']>;
  useBadge?: WebExtensionNavItem['useBadge'];
}

/** Admin nav links contributed by extensions, always absolute `/admin/ext/<name>/...` paths. */
function extensionNavLinks(extensions: readonly WebExtension[]): ExtensionNavLink[] {
  return extensions.flatMap((ext) =>
    (ext.adminNav ?? []).map((item) => ({
      key: `${ext.name}:${item.path}`,
      href: extensionPath(ext.name, item.path, true),
      labelKey: item.labelKey,
      icon: item.icon ?? Puzzle,
      useBadge: item.useBadge,
    })),
  );
}

function NavBadgeContent({ useBadge }: { useBadge: NonNullable<ExtensionNavLink['useBadge']> }) {
  const tExt = useExtensionTranslation();
  const badge = useBadge();
  if (!badge) return null;
  const count = typeof badge.count === 'number' && badge.count > 0 ? badge.count : 0;
  if (!count && !badge.attention) return null;
  const label = badge.labelKey ? tExt(badge.labelKey, badge.labelValues) : undefined;
  return (
    <span className="ml-auto flex shrink-0 items-center" data-testid="nav-badge">
      {count ? (
        <span
          aria-hidden={label ? true : undefined}
          data-tone={badge.attention ? 'attention' : 'count'}
          className={cn(
            'min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold',
            // Something to fix uses the warning tone (like the extensions' problem badges);
            // a plain count keeps the brand colour.
            badge.attention
              ? 'border border-warning/40 bg-warning/15 text-foreground'
              : 'bg-primary text-primary-foreground',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : (
        <span aria-hidden className="size-2 rounded-full bg-destructive" />
      )}
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** An extension's nav badge; a crash in its hook hides the badge, never the nav. */
function NavBadge({ useBadge }: { useBadge?: ExtensionNavLink['useBadge'] }) {
  if (!useBadge) return null;
  return (
    <ErrorBoundary fallback={null}>
      <NavBadgeContent useBadge={useBadge} />
    </ErrorBoundary>
  );
}

/** The red dot of a WhatsApp number that needs an admin; `label` names it for screen readers. */
function AttentionDot({ label }: { label?: string }) {
  return (
    <>
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full bg-danger"
        data-testid="settings-attention-dot"
      />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors md:min-h-9',
    'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    isActive
      ? 'bg-primary/10 text-primary'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
  );

function UnknownAdminRoute() {
  const { pathname } = useLocation();
  useEffect(() => {
    reportClientError({ kind: 'error', message: 'Unmatched admin route', route: pathname });
  }, [pathname]);
  // `/admin` picks the page for the screen: App settings on desktop, the Settings list on phones.
  return <Navigate to="/admin" replace />;
}

/** Desktop: the Settings side menu beside the rail (every admin page but the rail places Reports and Members). */
function SettingsNav() {
  const { t } = useTranslation(['admin', 'common']);
  const tExt = useExtensionTranslation();
  const extensions = useWebExtensions();
  const extensionLinks = extensionNavLinks(extensions);
  const { multiInbox } = useMultiInbox();
  const attention = useNumberAttention();
  // An extension page under a core section (e.g. an agent's sub-page) keeps that item active.
  const section = extensionSectionOf(extensions, useLocation().pathname);
  return (
    <nav aria-label={t('nav.label')} className="flex-1 p-2">
      <ul className="flex flex-col gap-1">
        {visibleAdminNav(multiInbox)
          .filter((n) => !RAIL_PLACES.has(n.to))
          .map((n) => (
            <li key={n.to}>
              <NavLink
                to={`/admin/${n.to}`}
                className={({ isActive }) =>
                  navLinkClass({ isActive: isActive || section === n.to })
                }
              >
                <n.icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{t(n.labelKey)}</span>
                {isNumbers(n.to) && attention && (
                  <AttentionDot label={t('common:appNav.attention')} />
                )}
              </NavLink>
            </li>
          ))}
        {extensionLinks.map((n) => (
          <li key={n.key}>
            <NavLink to={n.href} className={navLinkClass}>
              <n.icon className="size-4 shrink-0" aria-hidden />
              {tExt(n.labelKey)}
              <NavBadge useBadge={n.useBadge} />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The groups of the phone Settings list. A section in no group (a new `ADMIN_NAV` entry) is returned as
 * `ungrouped` and shows under More: phones have no other menu. Reports is left out (it has its own tab).
 */
export function settingsHomeGroups<T extends { to: string }>(nav: readonly T[]) {
  const pick = (...to: string[]) => to.flatMap((x) => nav.filter((n) => n.to === x));
  const groups = [
    { titleKey: 'common:appNav.team', items: pick('members', 'quick-replies') },
    {
      titleKey: 'common:appNav.business',
      items: pick('whatsapp', 'inboxes', 'safety', 'connectors', 'tunnel'),
    },
    { titleKey: 'common:appNav.app', items: pick('settings', 'audit') },
  ] as const;
  const grouped = new Set(['reports', ...groups.flatMap((g) => g.items.map((n) => n.to))]);
  return { groups, ungrouped: nav.filter((n) => !grouped.has(n.to)) };
}

const homeRowClass =
  'flex min-h-14 items-center gap-3 px-4 text-[15px] outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset';

/** Phone: the Settings tab's first page, one row per admin page (Members included), then the account. */
function SettingsHome() {
  const { t } = useTranslation(['admin', 'common']);
  const tExt = useExtensionTranslation();
  const extensionLinks = extensionNavLinks(useWebExtensions());
  const { multiInbox } = useMultiInbox();
  const attention = useNumberAttention();
  const { user } = useAuth();
  const nav = visibleAdminNav(multiInbox);
  const { groups, ungrouped } = settingsHomeGroups(nav);
  return (
    <div className="flex flex-col gap-5" data-testid="settings-home">
      {groups.map((g) => (
        <section key={g.titleKey} className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">{t(g.titleKey)}</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-surface">
            {g.items.map((n) => (
              <li key={n.to}>
                <Link to={`/admin/${n.to}`} className={homeRowClass}>
                  <n.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">{t(n.labelKey)}</span>
                  {isNumbers(n.to) && attention && (
                    <span className="flex items-center gap-1.5 text-sm text-danger">
                      <AttentionDot />
                      {t('common:appNav.attentionRow')}
                    </span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ungrouped.length + extensionLinks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            {t('common:appNav.more')}
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-surface">
            {ungrouped.map((n) => (
              <li key={n.to}>
                <Link to={`/admin/${n.to}`} className={homeRowClass}>
                  <n.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">{t(n.labelKey)}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
            {extensionLinks.map((n) => (
              <li key={n.key}>
                <Link to={n.href} className={homeRowClass}>
                  <n.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">{tExt(n.labelKey)}</span>
                  <NavBadge useBadge={n.useBadge} />
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-medium text-muted-foreground">
          {t('common:appNav.yourAccount')}
        </h2>
        <Link to="/account" className={cn(homeRowClass, 'rounded-xl border bg-surface')}>
          <UserRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{user?.displayName}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </section>
    </div>
  );
}

/** `/admin`: phones show the Settings list; desktop opens App settings (the rail and side menu do the rest). */
function AdminIndex() {
  const desktop = useMediaQuery('(min-width: 768px)');
  return desktop ? <Navigate to="/admin/settings" replace /> : <SettingsHome />;
}

/** The phone app bar of an admin page: a tab's own page has only its title, the others go back one level. */
function useAdminPhoneBar(section: WebExtensionAdminSection | undefined): {
  title: string;
  back?: { to: string; label: string };
} {
  const { t } = useTranslation(['admin', 'common']);
  const tExt = useExtensionTranslation();
  const { pathname } = useLocation();
  const extensions = useWebExtensions();
  const { multiInbox } = useMultiInbox();
  const settings = t('common:appNav.settings');
  const backTo = (to: string, place: string) => ({
    to,
    label: t('common:appNav.backTo', { place }),
  });
  if (pathname.startsWith('/admin/reports') || section === 'reports')
    return { title: t('common:appNav.reports') };
  // An agent's page (and an extension's agent sub-page) goes back to Members.
  if (pathname.startsWith('/admin/members/') || section === 'members')
    return { title: t('nav.members'), back: backTo('/admin/members', t('nav.members')) };
  const core = visibleAdminNav(multiInbox).find(
    (n) => pathname.startsWith(`/admin/${n.to}`) || section === n.to,
  );
  if (core) {
    // A connector's own page goes back to the gallery; every other page back to the Settings list.
    if (core.to === 'connectors' && pathname.startsWith('/admin/connectors/'))
      return { title: t(core.labelKey), back: backTo('/admin/connectors', t(core.labelKey)) };
    return { title: t(core.labelKey), back: backTo('/admin', settings) };
  }
  const ext = extensionNavLinks(extensions).find(
    (n) => pathname === n.href || pathname.startsWith(`${n.href}/`),
  );
  if (ext) return { title: tExt(ext.labelKey), back: backTo('/admin', settings) };
  return { title: settings };
}

/**
 * Admin area inside the app shell (rail on desktop, bottom tabs on phones). Reports and Members are full-width rail
 * places; every other admin page keeps the Settings side menu on desktop. Non-admins are redirected to `/`.
 */
export function AdminLayout() {
  const { user, isLoading } = useAuth();
  const { pathname } = useLocation();
  const version = useAppVersion();
  const { t } = useTranslation(['admin', 'common']);
  const extensions = useWebExtensions();
  const section = extensionSectionOf(extensions, pathname);
  const bar = useAdminPhoneBar(section);

  if (isLoading)
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center bg-background text-muted-foreground"
      >
        <Loader2 className="size-6 animate-spin" aria-hidden />
        <span className="sr-only">{t('layout.loading')}</span>
      </div>
    );
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;

  const railPlace =
    pathname.startsWith('/admin/reports') ||
    pathname.startsWith('/admin/members') ||
    (section !== undefined && RAIL_PLACES.has(section));

  return (
    <div className="safe-x flex h-full flex-col bg-background text-foreground md:flex-row">
      {/* The Settings list has no title of its own: there the bar's title is the page's h1. */}
      <PhoneBar
        title={bar.title}
        back={bar.back}
        heading={pathname === '/admin' || pathname === '/admin/'}
      />

      {/* Desktop: the Settings side menu, only on Settings pages (not on the rail places Reports and Members). */}
      {!railPlace && (
        <aside
          className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r bg-card md:flex"
          data-testid="settings-nav"
        >
          <div className="border-b px-4 py-4">
            <p className="text-lg font-semibold">{t('common:appNav.settingsTitle')}</p>
          </div>
          <SettingsNav />
          <footer aria-label={t('layout.footer')} className="safe-bottom border-t p-3">
            <AppCredits version={version ?? undefined} variant="sidebar" />
          </footer>
        </aside>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="admin-main">
        <ExtensionBannerSlot />
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:py-6">
          <Routes>
            <Route index element={<AdminIndex />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="safety" element={<SafetyPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="members/ai" element={<AiAgentIndexRoute />} />
            <Route path="members/ai/new" element={<AiMemberPage />} />
            <Route path="members/ai/:agentId" element={<AiAgentRoute />} />
            <Route path="quick-replies" element={<QuickRepliesPage />} />
            <Route path="connectors" element={<ConnectorsGalleryPage />} />
            <Route path="connectors/:id" element={<ConnectorDetailPage />} />
            <Route path="whatsapp" element={<WhatsAppRoute />} />
            <Route path="inboxes" element={<InboxesRoute />} />
            <Route
              path="inboxes/lite"
              element={
                <ErrorBoundary>
                  <LiteImportPage />
                </ErrorBoundary>
              }
            />
            <Route path="tunnel" element={<TunnelPage />} />
            <Route path="settings/*" element={<SettingsPage />} />
            <Route path="audit" element={<AuditPage />} />
            {extensionRoutes(extensions, true)}
            <Route path="*" element={<UnknownAdminRoute />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default AdminLayout;

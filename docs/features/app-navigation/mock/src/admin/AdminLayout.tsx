import { useEffect } from 'react';
import {
  BarChart3,
  ChevronRight,
  Loader2,
  MessageSquareText,
  ScrollText,
  Settings,
  Globe,
  Inbox,
  Smartphone,
  Plug,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useAppVersion } from '@/lib/version';
import { useMediaQuery } from '@/lib/use-media-query';
import { reportClientError } from '@/lib/error-reporter';
import { AppCredits } from '@/components/app';
// Proposed (custom-agents): one page per AI agent replaces the single AI Sales Agent page.
import { AgentPage, AgentRedirect } from './AgentPage';
import { useMockEdition } from '../mock/edition';
import { AuditPage } from './AuditPage';
import { MembersPage } from './MembersPage';
import { QuickRepliesPage } from './QuickRepliesPage';
import { SettingsPage } from './SettingsPage';
import { TunnelPage } from './TunnelPage';
import { WhatsAppPage } from './WhatsAppPage';
import { InboxesPage } from './InboxesPage';
import { ConnectorsGalleryPage } from './ConnectorsGalleryPage';
import { ConnectorDetailPage } from './ConnectorDetailPage';
// Baseline addition (reports, confirmed): Admin → Reports (busy days, busy times, reply times).
import { ReportsPage } from './ReportsPage';
// Proposed (app-navigation): Reports and Members are rail places; the rest of Admin is "Settings".
import { PhoneBar } from '../nav/PhoneBar';
import { useNumberAttention } from '../nav/AppNav';
import { setMockAttention, useMockAttention } from '../mock/appNav';

/** `labelKey` is a translation key in the `admin` namespace (`common:` for the app-navigation keys). */
export const ADMIN_NAV = [
  // Baseline addition (reports): first, the page an owner opens most.
  { to: 'reports', labelKey: 'mockReports.nav', icon: BarChart3 },
  { to: 'members', labelKey: 'nav.members', icon: Users },
  { to: 'quick-replies', labelKey: 'nav.quickReplies', icon: MessageSquareText },
  // Proposed (google-calendar): a gallery of ready connectors, one page each.
  { to: 'connectors', labelKey: 'mockConnectors.title', icon: Plug },
  // Proposed (multi-inbox): one inbox per WhatsApp number replaces the single WhatsApp page.
  { to: 'inboxes', labelKey: 'mockInbox.title', icon: Inbox },
  { to: 'tunnel', labelKey: 'nav.tunnel', icon: Globe },
  // Proposed (app-navigation): "App settings", so it does not repeat the area's name "Settings".
  { to: 'settings', labelKey: 'common:appNav.appSettings', icon: Settings },
  { to: 'audit', labelKey: 'nav.audit', icon: ScrollText },
] as const satisfies readonly { to: string; labelKey: string; icon: LucideIcon }[];

type LabelKey = (typeof ADMIN_NAV)[number]['labelKey'] | 'nav.whatsapp';
type NavEntry = { to: string; labelKey: LabelKey; icon: LucideIcon };

/** Proposed (custom-agents): the mock Lite view keeps Lite's single WhatsApp page instead of Inboxes. */
const LITE_NAV: readonly NavEntry[] = ADMIN_NAV.map((n) =>
  n.to === 'inboxes' ? { to: 'whatsapp', labelKey: 'nav.whatsapp', icon: Smartphone } : n,
);
function useAdminNav(): readonly NavEntry[] {
  return useMockEdition() === 'lite' ? LITE_NAV : ADMIN_NAV;
}

/** Proposed (app-navigation): the Settings side menu leaves out the two rail places (Reports, Members). */
const RAIL_PLACES = new Set(['reports', 'members']);
const isNumbers = (to: string) => to === 'inboxes' || to === 'whatsapp';

function UnknownAdminRoute() {
  const { pathname } = useLocation();
  useEffect(() => {
    reportClientError({ kind: 'error', message: 'Unmatched admin route', route: pathname });
  }, [pathname]);
  return <Navigate to="/admin/settings" replace />;
}

function AttentionDot({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-danger" />
      <span className="sr-only">{label}</span>
    </>
  );
}

/** Desktop: the Settings side menu beside the rail (detail pages of Settings only). */
function SettingsNav() {
  const { t } = useTranslation(['admin', 'common']);
  const nav = useAdminNav().filter((n) => !RAIL_PLACES.has(n.to));
  const attention = useNumberAttention();
  return (
    <nav aria-label={t('nav.label')} className="flex-1 p-2">
      <ul className="flex flex-col gap-1">
        {nav.map((n) => (
          <li key={n.to}>
            <NavLink
              to={`/admin/${n.to}`}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors md:min-h-9',
                  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <n.icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{t(n.labelKey)}</span>
              {isNumbers(n.to) && attention && (
                <AttentionDot label={t('common:appNav.attentionRow')} />
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Phone: the Settings tab's first page, one row per admin page (Members included), then the account. */
function SettingsHome() {
  const { t } = useTranslation(['admin', 'common']);
  const nav = useAdminNav();
  const attention = useNumberAttention();
  const mockAttention = useMockAttention();
  const { user } = useAuth();
  const byTo = (to: string) => nav.find((n) => n.to === to);
  const groups: {
    titleKey: 'common:appNav.team' | 'common:appNav.business' | 'common:appNav.app';
    items: NavEntry[];
  }[] = [
    {
      titleKey: 'common:appNav.team',
      items: [byTo('members'), byTo('quick-replies')].filter(Boolean) as NavEntry[],
    },
    {
      titleKey: 'common:appNav.business',
      items: [byTo('inboxes') ?? byTo('whatsapp'), byTo('connectors'), byTo('tunnel')].filter(
        Boolean,
      ) as NavEntry[],
    },
    {
      titleKey: 'common:appNav.app',
      items: [byTo('settings'), byTo('audit')].filter(Boolean) as NavEntry[],
    },
  ];
  const row =
    'flex min-h-14 items-center gap-3 px-4 text-[15px] outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset';
  return (
    <div className="flex flex-col gap-5" data-testid="settings-home">
      {groups.map((g) => (
        <section key={g.titleKey} className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">{t(g.titleKey)}</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-surface">
            {g.items.map((n) => (
              <li key={n.to}>
                <Link to={`/admin/${n.to}`} className={row}>
                  <n.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">{t(n.labelKey)}</span>
                  {isNumbers(n.to) && attention && (
                    <span className="flex items-center gap-1.5 text-sm text-danger">
                      <AttentionDot label="" />
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
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-medium text-muted-foreground">
          {t('common:appNav.yourAccount')}
        </h2>
        <Link to="/account" className={cn(row, 'rounded-xl border bg-surface')}>
          <UserRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{user?.displayName}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </section>
      {/* Mock only: show the red dot without breaking the demo's WhatsApp connection. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-3 py-2">
        <Badge variant="outline">{t('mockAgents.proposed')}</Badge>
        <Switch
          id="mock-attention"
          checked={mockAttention}
          onCheckedChange={setMockAttention}
          data-testid="mock-attention"
        />
        <Label htmlFor="mock-attention" className="text-sm">
          {t('common:appNav.mockAttention')}
        </Label>
      </div>
    </div>
  );
}

/** `/admin`: phones show the Settings list; desktop opens App settings (the rail and side menu do the rest). */
function AdminIndex() {
  const desktop = useMediaQuery('(min-width: 768px)');
  return desktop ? <Navigate to="/admin/settings" replace /> : <SettingsHome />;
}

/** The phone app bar for an admin page: a tab's page has only its title, others go back one level. */
function useAdminPhoneBar(): { title: string; back?: { to: string; label: string } } {
  const { t } = useTranslation(['admin', 'common']);
  const { pathname } = useLocation();
  const nav = useAdminNav();
  const settings = t('common:appNav.settings');
  if (pathname.startsWith('/admin/reports')) return { title: t('common:appNav.reports') };
  if (pathname.startsWith('/admin/members/ai'))
    return {
      title: t('nav.members'),
      back: { to: '/admin/members', label: t('common:appNav.backTo', { place: t('nav.members') }) },
    };
  const current = nav.find((n) => pathname.startsWith(`/admin/${n.to}`));
  if (!current) return { title: settings };
  // A connector's own page goes back to the gallery; every other Settings page back to the Settings list.
  if (current.to === 'connectors' && pathname.startsWith('/admin/connectors/'))
    return {
      title: t(current.labelKey),
      back: {
        to: '/admin/connectors',
        label: t('common:appNav.backTo', { place: t(current.labelKey) }),
      },
    };
  return {
    title: t(current.labelKey),
    back: { to: '/admin', label: t('common:appNav.backTo', { place: settings }) },
  };
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
  const bar = useAdminPhoneBar();

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

  const railPlace = pathname.startsWith('/admin/reports') || pathname.startsWith('/admin/members');

  return (
    <div className="safe-x flex h-full flex-col bg-background text-foreground md:flex-row">
      <PhoneBar title={bar.title} back={bar.back} />

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
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:py-6">
          <Routes>
            <Route index element={<AdminIndex />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="members/ai" element={<AgentRedirect />} />
            <Route path="members/ai/:agentId" element={<AgentPage />} />
            <Route path="quick-replies" element={<QuickRepliesPage />} />
            <Route path="whatsapp" element={<WhatsAppPage />} />
            <Route path="inboxes" element={<InboxesPage />} />
            <Route path="tunnel" element={<TunnelPage />} />
            <Route path="settings/*" element={<SettingsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="connectors" element={<ConnectorsGalleryPage />} />
            <Route path="connectors/:id" element={<ConnectorDetailPage />} />
            <Route path="*" element={<UnknownAdminRoute />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default AdminLayout;

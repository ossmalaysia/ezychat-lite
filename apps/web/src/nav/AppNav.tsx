// App navigation (docs/features/app-navigation/design.md): one navigation on every signed-in page. Desktop (768 px
// and up): a 64 px icon rail on the left. Phone (below 768 px): bottom tabs, hidden inside an open chat.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  BotMessageSquare,
  MessagesSquare,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import { cn } from '@/lib/utils';
import { useUnreadChatCount } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { UserMenu } from '../auth/UserMenu';
import { useChosenChatsOnly } from '../auth/chat-scope';
import { useAskEzy } from '../askezy/AskEzyContext';
import {
  extensionSectionOf,
  useWebExtensions,
  type WebExtensionAdminSection,
  type WebExtensionNavItem,
} from '../extensions';
import { useNumberAttention, useNumbersPath } from './attention';

type Place = 'chats' | 'reports' | 'members' | 'settings' | 'account' | null;

/** The rail place of a path; `section` is the core section an extension admin page sits under. */
export function placeOf(
  pathname: string,
  isAdmin: boolean,
  section?: WebExtensionAdminSection,
): Place {
  if (pathname === '/' || pathname.startsWith('/chats/')) return 'chats';
  if (pathname.startsWith('/admin/reports') || section === 'reports') return 'reports';
  if (pathname.startsWith('/admin/members') || section === 'members') return 'members';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'settings';
  if (pathname === '/account') return isAdmin ? 'settings' : 'account';
  return null;
}

/**
 * An extension admin link whose badge asks for attention also raises the Settings dot. Each probe calls one
 * extension's `useBadge` hook (a hook per component, so the list may change) and reports it; a crash hides only it.
 */
function ExtensionAttentionProbe({
  id,
  useBadge,
  onChange,
}: {
  id: string;
  useBadge: NonNullable<WebExtensionNavItem['useBadge']>;
  onChange: (id: string, on: boolean) => void;
}) {
  const on = useBadge()?.attention === true;
  useEffect(() => {
    onChange(id, on);
    return () => onChange(id, false);
  }, [id, on, onChange]);
  return null;
}

function useExtensionAttention(): { probes: ReactNode; attention: boolean } {
  const { isAdmin } = useAuth();
  const extensions = useWebExtensions();
  const [on, setOn] = useState<ReadonlySet<string>>(new Set());
  const onChange = useCallback((id: string, value: boolean) => {
    setOn((prev) => {
      if (prev.has(id) === value) return prev;
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  if (!isAdmin) return { probes: null, attention: false };
  const items = extensions.flatMap((ext) =>
    (ext.adminNav ?? []).flatMap((item) =>
      item.useBadge ? [{ id: `${ext.name}:${item.path}`, useBadge: item.useBadge }] : [],
    ),
  );
  const probes = items.map((item) => (
    <ErrorBoundary key={item.id} fallback={null}>
      <ExtensionAttentionProbe id={item.id} useBadge={item.useBadge} onChange={onChange} />
    </ErrorBoundary>
  ));
  return { probes, attention: items.some((item) => on.has(item.id)) };
}

function NavBadge({ count, dot, label }: { count?: number; dot?: boolean; label: string }) {
  if (count && count > 0)
    return (
      <>
        <span
          aria-hidden
          className="absolute -top-1 left-1/2 ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-unread px-1 text-[11px] font-bold text-primary-foreground tabular-nums ring-2 ring-background"
          data-testid="nav-unread-count"
        >
          {count > 99 ? '99+' : count}
        </span>
        <span className="sr-only">, {label}</span>
      </>
    );
  if (dot)
    return (
      <>
        <span
          aria-hidden
          className="absolute top-0.5 right-2.5 size-2.5 rounded-full bg-danger ring-2 ring-background"
          data-testid="nav-attention-dot"
        />
        <span className="sr-only">, {label}</span>
      </>
    );
  return null;
}

interface ItemProps {
  variant: 'rail' | 'tab';
  icon: LucideIcon;
  label: string;
  to?: string;
  onClick?: () => void;
  current?: boolean;
  pressed?: boolean;
  badge?: ReactNode;
  testId: string;
}

/** One destination: icon in a pill with the label under it. The whole cell is the hit area (≥ 56 × 56). */
function NavItem({
  variant,
  icon: Icon,
  label,
  to,
  onClick,
  current,
  pressed,
  badge,
  testId,
}: ItemProps) {
  const on = current || pressed;
  const inner = (
    <>
      <span
        className={cn(
          'relative flex h-8 items-center justify-center rounded-full transition-colors',
          variant === 'rail' ? 'w-12' : 'w-14',
          on ? 'bg-primary/10 text-primary' : 'text-muted-foreground group-hover:bg-muted',
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
        {badge}
      </span>
      <span
        className={cn(
          'line-clamp-2 max-w-full text-center text-xs leading-tight break-words whitespace-normal',
          on ? 'font-semibold text-primary' : 'text-muted-foreground group-hover:text-foreground',
        )}
      >
        {label}
      </span>
    </>
  );
  const className = cn(
    'group h-auto flex-col gap-1 rounded-lg px-0.5 font-medium hover:bg-transparent',
    variant === 'rail' ? 'w-16 py-1.5' : 'min-h-14 min-w-0 flex-1 pt-1.5 pb-1',
  );
  if (to)
    return (
      <Button asChild variant="ghost" className={className}>
        <Link to={to} aria-current={current ? 'page' : undefined} data-testid={testId}>
          {inner}
        </Link>
      </Button>
    );
  return (
    <Button
      variant="ghost"
      className={className}
      onClick={onClick}
      aria-pressed={pressed}
      data-testid={testId}
      // The open panel ignores an outside click on its own trigger, so the trigger can close it.
      data-ask-ezy-trigger
    >
      {inner}
    </Button>
  );
}

function useNav() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();
  const unread = useUnreadChatCount().data?.count ?? 0;
  const numbers = useNumberAttention();
  const numbersPath = useNumbersPath();
  const extension = useExtensionAttention();
  const ask = useAskEzy();
  // Ask Ezy reads across chats: hidden for an agent limited to chosen chats (the server refuses them too).
  const canAsk = !useChosenChatsOnly();
  const place = placeOf(pathname, isAdmin, extensionSectionOf(useWebExtensions(), pathname));
  const toggleAsk = () => (ask.open ? ask.closePanel() : ask.openPanel());
  return {
    t,
    isAdmin,
    unread,
    attention: numbers || extension.attention,
    // The dot leads to the broken number first; an extension's attention keeps App settings.
    settingsPath: numbers ? numbersPath : '/admin/settings',
    probes: extension.probes,
    ask,
    canAsk,
    place,
    toggleAsk,
  };
}

/** Desktop (768 px and up): the icon rail. Settings and the account photo sit at the bottom. */
export function AppRail() {
  const { t, isAdmin, unread, attention, settingsPath, probes, ask, canAsk, place, toggleAsk } =
    useNav();
  return (
    <nav
      aria-label={t('appNav.main')}
      className="safe-top safe-bottom hidden w-16 shrink-0 flex-col items-center gap-1 border-r bg-background py-3 md:flex"
      data-testid="app-rail"
    >
      {probes}
      <NavItem
        variant="rail"
        icon={MessagesSquare}
        label={t('appNav.chats')}
        to="/"
        current={place === 'chats'}
        badge={<NavBadge count={unread} label={t('appNav.unread', { count: unread })} />}
        testId="nav-chats"
      />
      {isAdmin && (
        <NavItem
          variant="rail"
          icon={BarChart3}
          label={t('appNav.reports')}
          to="/admin/reports"
          current={place === 'reports'}
          testId="nav-reports"
        />
      )}
      {canAsk && (
        <NavItem
          variant="rail"
          icon={BotMessageSquare}
          label={t('appNav.askEzy')}
          onClick={toggleAsk}
          pressed={ask.open}
          testId="nav-ask-ezy"
        />
      )}
      {isAdmin && (
        <NavItem
          variant="rail"
          icon={Users}
          label={t('appNav.members')}
          to="/admin/members"
          current={place === 'members'}
          testId="nav-members"
        />
      )}
      <div className="mt-auto flex flex-col items-center gap-2">
        {isAdmin && (
          <NavItem
            variant="rail"
            icon={Settings}
            label={t('appNav.settings')}
            to={settingsPath}
            current={place === 'settings'}
            badge={<NavBadge dot={attention} label={t('appNav.attention')} />}
            testId="nav-settings"
          />
        )}
        <UserMenu align="start" />
      </div>
    </nav>
  );
}

/** Phone (below 768 px): bottom tabs. Admins: Chats, Reports, Ask Ezy, Settings; others: Chats, Ask Ezy, Account. */
export function AppTabs() {
  const { t, isAdmin, unread, attention, probes, ask, canAsk, place, toggleAsk } = useNav();
  return (
    <nav
      aria-label={t('appNav.main')}
      className="safe-bottom flex shrink-0 border-t bg-surface px-1 md:hidden"
      data-testid="app-tabs"
    >
      {probes}
      <NavItem
        variant="tab"
        icon={MessagesSquare}
        label={t('appNav.chats')}
        to="/"
        current={place === 'chats' && !ask.open}
        badge={<NavBadge count={unread} label={t('appNav.unread', { count: unread })} />}
        testId="tab-chats"
      />
      {isAdmin && (
        <NavItem
          variant="tab"
          icon={BarChart3}
          label={t('appNav.reports')}
          to="/admin/reports"
          current={place === 'reports' && !ask.open}
          testId="tab-reports"
        />
      )}
      {canAsk && (
        <NavItem
          variant="tab"
          icon={BotMessageSquare}
          label={t('appNav.askEzy')}
          onClick={toggleAsk}
          pressed={ask.open}
          testId="tab-ask-ezy"
        />
      )}
      {isAdmin ? (
        <NavItem
          variant="tab"
          icon={Settings}
          label={t('appNav.settings')}
          to="/admin"
          current={(place === 'settings' || place === 'members') && !ask.open}
          badge={<NavBadge dot={attention} label={t('appNav.attention')} />}
          testId="tab-settings"
        />
      ) : (
        <NavItem
          variant="tab"
          icon={UserRound}
          label={t('appNav.account')}
          to="/account"
          current={place === 'account' && !ask.open}
          testId="tab-account"
        />
      )}
    </nav>
  );
}

/**
 * Signed-in shell: rail + page + tabs. No tab bar inside an open chat: the composer owns the bottom of the
 * screen. The Ask Ezy panel stays in App (a sheet in a portal, docked beside the page from 1280 px).
 */
export function AppShell() {
  const { pathname } = useLocation();
  const inChat = pathname.startsWith('/chats/');
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <AppRail />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Inbox and admin scroll inside themselves; an extension page that is taller scrolls here. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
        {!inChat && <AppTabs />}
      </div>
    </div>
  );
}

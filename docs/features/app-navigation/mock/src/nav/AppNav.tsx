// Proposed (app-navigation): one app navigation for every signed-in screen. Desktop (768 px and up): a 64 px icon
// rail on the left. Phone (below 768 px): bottom tabs, hidden inside an open chat. Ported from the idea of
// EzyChat Cloud's rail and tabs, drawn with Lite's own tokens and components.
import type React from 'react';
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
import { useChats, useWaStatus } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { UserMenu } from '../auth/UserMenu';
import { useChosenChatsOnly } from '../auth/chat-scope';
import { AskEzyPanel } from '../askezy/AskEzyPanel';
import { useAskEzy } from '../askezy/AskEzyContext';
import { accessOf, canOpen, inboxOfChat, useMockInboxes } from '../mock/inboxes';
import { useMyChats } from '../mock/memberChats';
import { useMockEdition } from '../mock/edition';
import { useMockAttention } from '../mock/appNav';

/** WhatsApp states an admin must act on (the same ones WaBanner shows as warning or danger). */
const ATTENTION_STATES = new Set(['disconnected', 'qr', 'logged_out', 'replaced', 'blocked']);

/**
 * Chats with unread messages the user may open (every inbox of theirs, open chats), from the chat list the inbox
 * already loads. Mock: filtered here like ChatList does; the app would get one count from the server.
 */
function useUnreadChats(): number {
  const chats = useChats({ assigned: 'any', status: 'open' });
  const inboxes = useMockInboxes();
  const { user } = useAuth();
  const mine = useMyChats();
  const access = accessOf(inboxes, user);
  const seen = new Set<string>();
  return (chats.data?.pages ?? [])
    .flatMap((p) => p.chats)
    .filter((c) => {
      if (seen.has(c.jid) || (c.unreadCount ?? 0) === 0) return false;
      seen.add(c.jid);
      return mine.limited ? mine.jids.has(c.jid) : canOpen(access, inboxOfChat(inboxes, c.jid)?.id);
    }).length;
}

/** True when a WhatsApp number needs an admin (not linked, logged out, phone offline, Business API token rejected). */
export function useNumberAttention(): boolean {
  const { isAdmin } = useAuth();
  const wa = useWaStatus({ enabled: isAdmin });
  const { inboxes } = useMockInboxes();
  const mock = useMockAttention();
  if (!isAdmin) return false;
  return (
    mock ||
    ATTENTION_STATES.has(wa.data?.state ?? 'open') ||
    inboxes.some((i) => i.status !== 'connected')
  );
}

/** Where the attention dot leads: the page of the numbers (Lite: WhatsApp, more numbers: Inboxes). */
export function useNumbersPath(): string {
  return useMockEdition() === 'lite' ? '/admin/whatsapp' : '/admin/inboxes';
}

type Place = 'chats' | 'reports' | 'members' | 'settings' | 'account' | null;

function placeOf(pathname: string, isAdmin: boolean): Place {
  if (pathname === '/' || pathname.startsWith('/chats')) return 'chats';
  if (pathname.startsWith('/admin/reports')) return 'reports';
  if (pathname.startsWith('/admin/members')) return 'members';
  if (pathname.startsWith('/admin')) return 'settings';
  if (pathname.startsWith('/account')) return isAdmin ? 'settings' : 'account';
  return null;
}

function Badge({ count, dot, label }: { count?: number; dot?: boolean; label: string }) {
  if (count && count > 0)
    return (
      <>
        <span
          aria-hidden
          className="absolute -top-1 left-1/2 ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-unread px-1 text-[11px] font-bold text-primary-foreground tabular-nums ring-2 ring-background"
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
  badge?: React.ReactNode;
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
  const unread = useUnreadChats();
  const attention = useNumberAttention();
  const numbersPath = useNumbersPath();
  const ask = useAskEzy();
  const canAsk = !useChosenChatsOnly();
  const place = placeOf(pathname, isAdmin);
  const toggleAsk = () => (ask.open ? ask.closePanel() : ask.openPanel());
  return { t, isAdmin, unread, attention, numbersPath, ask, canAsk, place, toggleAsk };
}

/** Desktop (768 px and up): the icon rail. Settings and the account photo sit at the bottom. */
export function AppRail() {
  const { t, isAdmin, unread, attention, numbersPath, ask, canAsk, place, toggleAsk } = useNav();
  return (
    <nav
      aria-label={t('appNav.main')}
      className="safe-top safe-bottom hidden w-16 shrink-0 flex-col items-center gap-1 border-r bg-background py-3 md:flex"
      data-testid="app-rail"
    >
      <NavItem
        variant="rail"
        icon={MessagesSquare}
        label={t('appNav.chats')}
        to="/"
        current={place === 'chats'}
        badge={<Badge count={unread} label={t('appNav.unread', { count: unread })} />}
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
            to={attention ? numbersPath : '/admin/settings'}
            current={place === 'settings'}
            badge={<Badge dot={attention} label={t('appNav.attention')} />}
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
  const { t, isAdmin, unread, attention, ask, canAsk, place, toggleAsk } = useNav();
  return (
    <nav
      aria-label={t('appNav.main')}
      className="safe-bottom flex shrink-0 border-t bg-surface px-1 md:hidden"
      data-testid="app-tabs"
    >
      <NavItem
        variant="tab"
        icon={MessagesSquare}
        label={t('appNav.chats')}
        to="/"
        current={place === 'chats' && !ask.open}
        badge={<Badge count={unread} label={t('appNav.unread', { count: unread })} />}
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
          badge={<Badge dot={attention} label={t('appNav.attention')} />}
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
 * Signed-in shell: rail + page + tabs, and the Ask Ezy panel (docked beside the page from 1280 px, over it below,
 * full screen on phones). No tab bar inside an open chat: the composer owns the bottom of the screen.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const inChat = pathname.startsWith('/chats/');
  const canAsk = !useChosenChatsOnly();
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <AppRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
        {!inChat && <AppTabs />}
      </div>
      {canAsk && (
        <ErrorBoundary>
          <AskEzyPanel />
        </ErrorBoundary>
      )}
    </div>
  );
}

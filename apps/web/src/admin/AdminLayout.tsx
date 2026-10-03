import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  ScrollText,
  Settings,
  Smartphone,
  Globe,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { PushToggle } from '../pwa/PushToggle';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAppVersion } from '@/lib/version';
import { reportClientError } from '@/lib/error-reporter';
import { AppCredits } from '@/components/app';
import { AuditPage } from './AuditPage';
import { MembersPage } from './MembersPage';
import { QuickRepliesPage } from './QuickRepliesPage';
import { SettingsPage } from './SettingsPage';
import { TunnelPage } from './TunnelPage';
import { WhatsAppPage } from './WhatsAppPage';

export const ADMIN_NAV: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: 'members', label: 'Members', icon: Users },
  { to: 'quick-replies', label: 'Quick replies', icon: MessageSquareText },
  { to: 'whatsapp', label: 'WhatsApp', icon: Smartphone },
  { to: 'tunnel', label: 'Cloudflare', icon: Globe },
  { to: 'settings', label: 'Settings', icon: Settings },
  { to: 'audit', label: 'Audit', icon: ScrollText },
];

function UnknownAdminRoute() {
  const { pathname } = useLocation();
  useEffect(() => {
    reportClientError({ kind: 'error', message: 'Unmatched admin route', route: pathname });
  }, [pathname]);
  return <Navigate to="/admin/members" replace />;
}

function AdminNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  return (
    <nav aria-label="Admin sections" className={className}>
      <ul className="flex flex-col gap-1">
        {ADMIN_NAV.map((n) => (
          <li key={n.to}>
            <NavLink
              to={`/admin/${n.to}`}
              onClick={onNavigate}
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
              {n.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AdminFooter({ version, onNavigate }: { version?: string; onNavigate?: () => void }) {
  const { logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      onNavigate?.();
    } catch (error) {
      toast.error(`Could not log out: ${errorMessage(error)}`);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <footer
      aria-label="Admin tools and support"
      className="safe-bottom flex shrink-0 flex-col gap-1 border-t p-3"
    >
      <PushToggle compact className="px-2" />
      <Button asChild variant="ghost" size="touch" className="justify-start px-2 text-primary">
        <Link to="/" onClick={onNavigate}>
          <ChevronLeft aria-hidden />
          Back to inbox
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="touch"
        className="justify-start px-2 text-muted-foreground"
        disabled={loggingOut}
        aria-busy={loggingOut}
        onClick={() => void handleLogout()}
      >
        {loggingOut ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        {loggingOut ? 'Logging out…' : 'Log out'}
      </Button>
      <Separator className="my-1" />
      <AppCredits version={version} variant="sidebar" />
    </footer>
  );
}

function AdminMenu({ version, onNavigate }: { version?: string; onNavigate?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AdminNav className="flex-1 p-2" onNavigate={onNavigate} />
      <AdminFooter version={version} onNavigate={onNavigate} />
    </div>
  );
}

/**
 * Admin shell. Side nav on >= md; on phones a top bar with a Sheet menu.
 * Mounted by App.tsx at `/admin/*`; non-admins are redirected to `/`.
 */
export function AdminLayout() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const version = useAppVersion();

  if (isLoading)
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground"
      >
        <Loader2 className="size-6 animate-spin" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    );
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;

  const current = ADMIN_NAV.find((n) => location.pathname.includes(`/admin/${n.to}`));

  return (
    <div className="safe-x flex min-h-dvh flex-col bg-background text-foreground md:flex-row">
      {/* Phone: top bar with section menu */}
      <header className="safe-top sticky top-0 z-20 border-b bg-card md:hidden">
        <div className="flex items-center gap-1 px-1">
          <Button asChild variant="ghost" size="touch" className="px-2 text-primary">
            <Link to="/">
              <ChevronLeft aria-hidden />
              Inbox
            </Link>
          </Button>
          <p className="min-w-0 flex-1 truncate text-center text-base font-semibold">
            {current ? `Admin · ${current.label}` : 'Admin'}
          </p>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-touch" aria-label="Admin menu">
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 p-0">
              <SheetHeader className="border-b">
                <SheetTitle>Admin</SheetTitle>
                <SheetDescription>EzyChat Lite</SheetDescription>
              </SheetHeader>
              <AdminMenu version={version ?? undefined} onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Desktop: side nav */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="border-b px-4 py-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              EzyChat Lite
            </p>
            <p className="text-lg font-semibold">Admin</p>
          </div>
          <AdminMenu version={version ?? undefined} />
        </div>
      </aside>

      <main className="safe-bottom min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:py-6">
          <Routes>
            <Route index element={<Navigate to="/admin/members" replace />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="quick-replies" element={<QuickRepliesPage />} />
            <Route path="whatsapp" element={<WhatsAppPage />} />
            <Route path="tunnel" element={<TunnelPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="*" element={<UnknownAdminRoute />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default AdminLayout;

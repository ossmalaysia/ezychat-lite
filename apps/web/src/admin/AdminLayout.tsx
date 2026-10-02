import clsx from 'clsx';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { FullPageSpinner } from '../components/ui';
import { PushToggle } from '../pwa/PushToggle';
import { AuditPage } from './AuditPage';
import { MembersPage } from './MembersPage';
import { QuickRepliesPage } from './QuickRepliesPage';
import { SettingsPage } from './SettingsPage';
import { TunnelPage } from './TunnelPage';
import { WhatsAppPage } from './WhatsAppPage';

export const ADMIN_NAV = [
  { to: 'members', label: 'Members' },
  { to: 'quick-replies', label: 'Quick replies' },
  { to: 'whatsapp', label: 'WhatsApp' },
  { to: 'tunnel', label: 'Tunnel' },
  { to: 'settings', label: 'Settings' },
  { to: 'audit', label: 'Audit' },
] as const;

/**
 * Admin shell. Side nav on >= md, horizontally scrolling tab bar on phones.
 * Mounted by App.tsx at `/admin/*`; non-admins are redirected to `/`.
 */
export function AdminLayout() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="safe-x flex min-h-dvh flex-col bg-neutral-50 md:flex-row dark:bg-neutral-950">
      {/* Phone: header + tab bar */}
      <header className="safe-top sticky top-0 z-20 border-b border-neutral-200 bg-white md:hidden dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2 px-2">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"
          >
            <BackIcon /> Inbox
          </Link>
          <h1 className="flex-1 truncate text-center text-base font-semibold">Admin</h1>
          <span className="w-16" aria-hidden="true" />
        </div>
        <nav aria-label="Admin sections" className="overflow-x-auto">
          <ul className="flex min-w-max gap-1 px-2 pb-2">
            {ADMIN_NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  className={({ isActive }) =>
                    clsx(
                      'inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium',
                      isActive
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-neutral-950'
                        : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                    )
                  }
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* Desktop: side nav */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex dark:border-neutral-800 dark:bg-neutral-900">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              WA Team Inbox
            </p>
            <p className="text-lg font-semibold">Admin</p>
          </div>
          <nav aria-label="Admin sections" className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-1">
              {ADMIN_NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    className={({ isActive }) =>
                      clsx(
                        'flex min-h-10 items-center rounded-lg px-3 text-sm font-medium',
                        isActive
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                      )
                    }
                  >
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="space-y-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
            <PushToggle compact />
            <Link
              to="/"
              className="flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium text-emerald-700 hover:bg-neutral-100 dark:text-emerald-400 dark:hover:bg-neutral-800"
            >
              <BackIcon /> Back to inbox
            </Link>
          </div>
        </div>
      </aside>

      <main className="safe-bottom min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:py-6">
          <Routes>
            <Route index element={<Navigate to="members" replace />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="quick-replies" element={<QuickRepliesPage />} />
            <Route path="whatsapp" element={<WhatsAppPage />} />
            <Route path="tunnel" element={<TunnelPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="members" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default AdminLayout;

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatFilters as Filters } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from '../components/ui';
import { PushToggle } from '../pwa/PushToggle';
import { decodeJid } from '../lib/jid';
import { ChatFilters } from './ChatFilters';
import { ChatList } from './ChatList';
import { Conversation } from './Conversation';
import { useDirectory } from './useDirectory';
import { WaBanner } from './WaBanner';

const FILTERS_KEY = 'wati.inbox.filters';
const DEFAULT_FILTERS: Filters = { assigned: 'any', status: 'open' };

function loadFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const v = JSON.parse(raw) as Partial<Filters>;
    const assigned = v.assigned === 'me' || v.assigned === 'none' ? v.assigned : 'any';
    const status = v.status === 'resolved' ? 'resolved' : 'open';
    return { assigned, status, q: typeof v.q === 'string' && v.q ? v.q : undefined };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function UserMenu() {
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const itemCls =
    'flex min-h-11 w-full items-center px-4 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-11 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <Avatar name={user.displayName} seed={`user-${user.id}`} size="sm" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
            <p className="truncate text-sm font-semibold">{user.displayName}</p>
            <p className="truncate text-xs text-neutral-500">
              @{user.username} · {user.role}
            </p>
          </div>
          {isAdmin && (
            <Link role="menuitem" to="/admin" className={itemCls} onClick={() => setOpen(false)}>
              Admin settings
            </Link>
          )}
          <PushToggle
            compact
            className="border-b border-neutral-100 px-4 py-2 dark:border-neutral-800"
          />
          <Link
            role="menuitem"
            to="/change-password"
            className={itemCls}
            onClick={() => setOpen(false)}
          >
            Change password
          </Link>
          <button
            type="button"
            role="menuitem"
            className={clsx(itemCls, 'text-red-700 dark:text-red-400')}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function InboxPage() {
  const params = useParams<{ jid?: string }>();
  const jid = params.jid ? decodeJid(params.jid) : null;
  const navigate = useNavigate();
  const directory = useDirectory();
  const [filters, setFilters] = useState<Filters>(loadFilters);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* storage unavailable */
    }
  }, [filters]);

  return (
    <div className="safe-x flex h-dvh flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <div className="safe-top bg-white dark:bg-neutral-900" />
      <WaBanner />
      <div className="flex min-h-0 flex-1">
        <aside
          className={clsx(
            'min-h-0 w-full flex-col border-neutral-200 bg-white md:w-[360px] md:shrink-0 md:border-r dark:border-neutral-800 dark:bg-neutral-950',
            jid ? 'hidden md:flex' : 'flex',
          )}
          aria-label="Chats"
        >
          <header className="flex items-center gap-2 px-3 py-1">
            <h1 className="flex-1 py-2 text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
              Inbox
            </h1>
            <UserMenu />
          </header>
          <ChatFilters value={filters} onChange={setFilters} />
          <ChatList filters={filters} activeJid={jid} directory={directory} />
          <div className="safe-bottom" />
        </aside>
        <main
          className={clsx(
            'min-h-0 min-w-0 flex-1 flex-col bg-neutral-100 dark:bg-neutral-950',
            jid ? 'flex' : 'hidden md:flex',
          )}
        >
          {jid ? (
            <Conversation key={jid} jid={jid} directory={directory} onBack={() => navigate('/')} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <div className="rounded-full bg-emerald-100 p-4 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <svg
                  viewBox="0 0 24 24"
                  className="size-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M4 5h16v11H8l-4 4z" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-base font-semibold text-neutral-800 dark:text-neutral-100">
                Select a chat
              </p>
              <p className="max-w-xs text-sm text-neutral-500 dark:text-neutral-400">
                Pick a conversation from the list to read and reply as a team.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default InboxPage;

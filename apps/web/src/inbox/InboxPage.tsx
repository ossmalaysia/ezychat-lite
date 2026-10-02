import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ChatFilters as Filters } from '../api/queries';
import { UserMenu } from '../auth/UserMenu';
import { EmptyState } from '@/components/app';
import { cn } from '@/lib/utils';
import { decodeJid } from '../lib/jid';
import { ChatFilters } from './ChatFilters';
import { ChatList } from './ChatList';
import { Conversation } from './Conversation';
import { useDirectory } from './useDirectory';
import { ReconnectBanner } from './ReconnectBanner';
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

export function InboxPage() {
  const params = useParams<{ jid?: string }>();
  const jid = params.jid ? decodeJid(params.jid) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const directory = useDirectory();

  // Mobile back: when the conversation was opened from the list, pop history so the hardware /
  // swipe back gesture doesn't bounce into the chat again; deep links replace instead.
  const fromList = (location.state as { fromList?: boolean } | null)?.fromList === true;
  const onBack = useCallback(() => {
    if (fromList) navigate(-1);
    else navigate('/', { replace: true });
  }, [fromList, navigate]);
  const [filters, setFilters] = useState<Filters>(loadFilters);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* storage unavailable */
    }
  }, [filters]);

  return (
    <div className="safe-x flex h-dvh flex-col overflow-hidden bg-background">
      <div className="safe-top bg-surface" />
      <WaBanner />
      <ReconnectBanner />
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'min-h-0 w-full flex-col bg-surface md:w-[360px] md:shrink-0 md:border-r',
            jid ? 'hidden md:flex' : 'flex',
          )}
          aria-label="Chats"
        >
          <header className="flex items-center gap-2 px-3 py-1">
            <h1 className="flex-1 py-2 text-xl font-semibold tracking-tight text-foreground">
              Inbox
            </h1>
            <UserMenu />
          </header>
          <ChatFilters value={filters} onChange={setFilters} />
          <ChatList filters={filters} activeJid={jid} directory={directory} />
          <div className="safe-bottom" />
        </aside>
        <main
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col bg-background',
            jid ? 'flex' : 'hidden md:flex',
          )}
        >
          {jid ? (
            <Conversation key={jid} jid={jid} directory={directory} onBack={onBack} />
          ) : (
            <EmptyState
              className="flex-1"
              illustration="/illustrations/empty-inbox.png"
              title="Select a chat"
              description="Pick a conversation from the list to read and reply as a team."
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default InboxPage;

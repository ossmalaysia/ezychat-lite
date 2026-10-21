import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Inbox, WaStatus } from '@ezychat/shared';
import { PRIMARY_INBOX_ID, useInboxes, useWaStatus } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { useVisibleInboxes } from './useVisibleInboxes';

type WaStateName = WaStatus['state'];
type BannerTone = 'info' | 'warning' | 'danger';

/** States where outgoing messages are queued and will go out once reconnected. */
export function waQueuesMessages(state: WaStateName | undefined): boolean {
  return state === 'disconnected' || state === 'connecting';
}

/** States where sending is pointless until an admin acts (composer disabled). */
export function waSendingBlocked(state: WaStateName | undefined): boolean {
  return state === 'qr' || state === 'logged_out' || state === 'replaced' || state === 'blocked';
}

const copy = {
  connecting: {
    tone: 'info',
    titleKey: 'waBanner.connecting.title',
    inboxTitleKey: 'waBanner.inbox.connecting',
    bodyKey: 'waBanner.connecting.body',
  },
  disconnected: {
    tone: 'warning',
    titleKey: 'waBanner.disconnected.title',
    inboxTitleKey: 'waBanner.inbox.disconnected',
    bodyKey: 'waBanner.disconnected.body',
  },
  qr: {
    tone: 'warning',
    titleKey: 'waBanner.qr.title',
    inboxTitleKey: 'waBanner.inbox.qr',
    bodyKey: 'waBanner.qr.body',
  },
  logged_out: {
    tone: 'danger',
    titleKey: 'waBanner.loggedOut.title',
    inboxTitleKey: 'waBanner.inbox.loggedOut',
    bodyKey: 'waBanner.loggedOut.body',
  },
  replaced: {
    tone: 'danger',
    titleKey: 'waBanner.replaced.title',
    inboxTitleKey: 'waBanner.inbox.replaced',
    bodyKey: 'waBanner.replaced.body',
  },
  blocked: {
    tone: 'danger',
    titleKey: 'waBanner.blocked.title',
    inboxTitleKey: 'waBanner.inbox.blocked',
    bodyKey: 'waBanner.blocked.body',
  },
} as const satisfies Record<
  Exclude<WaStateName, 'open'>,
  { tone: BannerTone; titleKey: string; inboxTitleKey: string; bodyKey: string }
>;

/** One banner for a connection that is not open; `name` titles it with the inbox (2+ inboxes). */
function StateBanner({
  state,
  name,
  settingsPath,
}: {
  state: Exclude<WaStateName, 'open'>;
  name?: string;
  settingsPath: string;
}) {
  const { t } = useTranslation('inbox');
  const { isAdmin } = useAuth();
  const c = copy[state];
  // With several inboxes the link opens Admin → Inboxes, so it is named that way.
  const openLabel =
    settingsPath === '/admin/inboxes' ? t('waBanner.openInboxes') : t('waBanner.openSettings');
  return (
    <Banner
      tone={c.tone}
      title={name === undefined ? t(c.titleKey) : t(c.inboxTitleKey, { name })}
      action={
        isAdmin ? (
          <Button asChild variant="outline" size="touch" className="sm:h-8 sm:min-h-8">
            <Link to={settingsPath} aria-label={openLabel}>
              <span className="sm:hidden">{t('waBanner.settingsShort')}</span>
              <span className="hidden sm:inline">{openLabel}</span>
            </Link>
          </Button>
        ) : undefined
      }
    >
      {t(c.bodyKey)}
    </Banner>
  );
}

/**
 * Top-of-inbox banner shown whenever a WhatsApp connection isn't open. With one inbox (Lite) it is
 * today's single banner; with two or more visible inboxes there is one per inbox that is not open,
 * titled with that inbox's name. A user who sees one inbox other than inbox 1 gets that inbox's
 * banner (named, never inbox 1's state); with several inboxes and none visible there is no banner.
 */
export function WaBanner() {
  const list = useInboxes();
  const visible = useVisibleInboxes();
  const only = visible.length === 1 ? visible[0] : undefined;
  const multiInbox = (list.data?.maxInboxes ?? 1) > 1;
  // Read inbox 1's status only once the list shows the user sees it (or the list failed).
  const needsPrimary =
    list.isError ||
    visible.some((i) => i.id === PRIMARY_INBOX_ID) ||
    (list.data != null && visible.length === 0 && !multiInbox);
  const wa = useWaStatus({ enabled: needsPrimary });
  if (list.isPending) return null;
  if (visible.length > 1) {
    const down = visible
      .map((inbox) => ({ inbox, state: inboxState(inbox, wa.data) }))
      .filter((x): x is { inbox: Inbox; state: Exclude<WaStateName, 'open'> } =>
        Boolean(x.state && x.state !== 'open'),
      );
    if (down.length === 0) return null;
    return (
      <div className="space-y-2 border-b bg-surface px-3 py-2">
        {down.map(({ inbox, state }) => (
          <StateBanner
            key={inbox.id}
            state={state}
            name={inbox.name}
            settingsPath="/admin/inboxes"
          />
        ))}
      </div>
    );
  }
  if (list.data && visible.length === 0 && multiInbox) return null;
  const other = only && only.id !== PRIMARY_INBOX_ID ? only : undefined;
  const state = other ? other.status.state : wa.data?.state;
  if (!state || state === 'open') return null;
  return (
    <div className="border-b bg-surface px-3 py-2">
      {other ? (
        <StateBanner state={state} name={other.name} settingsPath="/admin/inboxes" />
      ) : (
        <StateBanner state={state} settingsPath="/admin/whatsapp" />
      )}
    </div>
  );
}

/** Inbox 1 follows `GET /api/wa/status` (as the composer does); other inboxes their list status. */
function inboxState(inbox: Inbox, primary: WaStatus | undefined): WaStateName | undefined {
  return inbox.id === PRIMARY_INBOX_ID
    ? (primary?.state ?? inbox.status.state)
    : inbox.status.state;
}

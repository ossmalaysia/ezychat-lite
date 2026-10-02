import { Link } from 'react-router-dom';
import type { WaStatus } from '@wa-team-inbox/shared';
import { useWaStatus } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { Banner, type BannerTone } from '../components/legacy';

type WaStateName = WaStatus['state'];

/** States where outgoing messages are queued and will go out once reconnected. */
export function waQueuesMessages(state: WaStateName | undefined): boolean {
  return state === 'disconnected' || state === 'connecting';
}

/** States where sending is pointless until an admin acts (composer disabled). */
export function waSendingBlocked(state: WaStateName | undefined): boolean {
  return state === 'qr' || state === 'logged_out' || state === 'replaced' || state === 'blocked';
}

const copy: Record<Exclude<WaStateName, 'open'>, { tone: BannerTone; title: string; body: string }> =
  {
    connecting: {
      tone: 'info',
      title: 'Connecting to WhatsApp…',
      body: 'Messages you send will go out when the connection is back.',
    },
    disconnected: {
      tone: 'warning',
      title: 'WhatsApp is disconnected',
      body: 'Reconnecting automatically. Messages will send when reconnected.',
    },
    qr: {
      tone: 'warning',
      title: 'WhatsApp is not linked',
      body: 'An admin needs to scan the QR code to link the team number.',
    },
    logged_out: {
      tone: 'error',
      title: 'WhatsApp was logged out',
      body: 'An admin must re-link the number before messages can be sent.',
    },
    replaced: {
      tone: 'error',
      title: 'WhatsApp opened in another session',
      body: 'This app was disconnected because the number was used elsewhere. An admin can take over.',
    },
    blocked: {
      tone: 'error',
      title: 'WhatsApp connection blocked',
      body: 'The connection was refused. An admin should check the WhatsApp page.',
    },
  };

/** Top-of-inbox banner shown whenever the WhatsApp connection isn't open. */
export function WaBanner() {
  const { isAdmin } = useAuth();
  const wa = useWaStatus();
  const state = wa.data?.state;
  if (!state || state === 'open') return null;
  const c = copy[state];
  return (
    <div className="border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <Banner
        tone={c.tone}
        title={c.title}
        action={
          isAdmin ? (
            <Link
              to="/admin/whatsapp"
              className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold underline underline-offset-2"
            >
              Open WhatsApp settings
            </Link>
          ) : undefined
        }
      >
        {c.body}
      </Banner>
    </div>
  );
}

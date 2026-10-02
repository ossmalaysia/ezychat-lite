import { Link } from 'react-router-dom';
import type { WaStatus } from '@wa-team-inbox/shared';
import { useWaStatus } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';

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
      tone: 'danger',
      title: 'WhatsApp was logged out',
      body: 'An admin must re-link the number before messages can be sent.',
    },
    replaced: {
      tone: 'danger',
      title: 'WhatsApp opened in another session',
      body: 'This app was disconnected because the number was used elsewhere. An admin can take over.',
    },
    blocked: {
      tone: 'danger',
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
    <div className="border-b bg-surface px-3 py-2">
      <Banner
        tone={c.tone}
        title={c.title}
        action={
          isAdmin ? (
            <Button asChild variant="outline" size="touch" className="sm:h-8 sm:min-h-8">
              <Link to="/admin/whatsapp" aria-label="Open WhatsApp settings">
                <span className="sm:hidden">Settings</span>
                <span className="hidden sm:inline">Open WhatsApp settings</span>
              </Link>
            </Button>
          ) : undefined
        }
      >
        {c.body}
      </Banner>
    </div>
  );
}

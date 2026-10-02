import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { WaState } from '@wa-team-inbox/shared';
import { useWaAction, useWaStatus, type WaAction } from '../api/queries';
import { Banner, Button, Card, Spinner } from '../components/ui';
import { Badge, ConfirmModal, ErrorState, PageHeader, type BadgeTone } from './adminUi';

export const WA_STATE_LABEL: Record<WaState, { label: string; tone: BadgeTone }> = {
  open: { label: 'Connected', tone: 'success' },
  connecting: { label: 'Connecting', tone: 'info' },
  qr: { label: 'Waiting for QR scan', tone: 'warning' },
  disconnected: { label: 'Disconnected', tone: 'warning' },
  logged_out: { label: 'Logged out', tone: 'error' },
  replaced: { label: 'Opened elsewhere', tone: 'error' },
  blocked: { label: 'Blocked', tone: 'error' },
};

const ACTIONS: Record<
  WaAction,
  { label: string; title: string; body: string; danger: boolean }
> = {
  logout: {
    label: 'Log out',
    title: 'Log out of WhatsApp?',
    body: 'The linked device is removed from the phone. The team inbox stops receiving and sending messages until you link again. Message history is kept.',
    danger: true,
  },
  relink: {
    label: 'Re-link',
    title: 'Re-link WhatsApp?',
    body: 'The current session is discarded and a new QR code is shown. Scan it from WhatsApp > Linked devices on the phone.',
    danger: true,
  },
  takeover: {
    label: 'Take over',
    title: 'Take over the session?',
    body: 'Another instance (e.g. WhatsApp Web on another computer) replaced this connection. Taking over reconnects here and disconnects the other one.',
    danger: false,
  },
};

function formatPhone(jid: string): string {
  const num = jid.split('@')[0]?.split(':')[0] ?? jid;
  return /^\d+$/.test(num) ? `+${num}` : num;
}

export function WhatsAppPage() {
  const wa = useWaStatus();
  const action = useWaAction();
  const [pending, setPending] = useState<WaAction | null>(null);

  if (wa.isPending)
    return (
      <div className="flex justify-center py-10 text-emerald-600">
        <Spinner className="size-6" />
      </div>
    );
  if (wa.isError) return <ErrorState error={wa.error} onRetry={() => void wa.refetch()} />;

  const s = wa.data;
  const meta = WA_STATE_LABEL[s.state] ?? { label: s.state, tone: 'neutral' as const };

  return (
    <div className="space-y-4">
      <PageHeader title="WhatsApp" description="The WhatsApp number linked to this team inbox." />

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-neutral-500">Status</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        {s.me && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-500">Linked number</dt>
              <dd className="font-medium">{formatPhone(s.me.jid)}</dd>
            </div>
            {s.me.name && (
              <div>
                <dt className="text-neutral-500">Name</dt>
                <dd className="font-medium">{s.me.name}</dd>
              </div>
            )}
          </dl>
        )}
        {s.lastError && s.state !== 'open' && (
          <Banner tone="warning" className="mt-4">
            {s.lastError}
          </Banner>
        )}
        {s.state === 'replaced' && (
          <Banner tone="error" className="mt-4" title="Session opened elsewhere">
            This number was connected from another place. Use “Take over” to reconnect here.
          </Banner>
        )}
        {(s.state === 'logged_out' || s.state === 'blocked') && (
          <Banner tone="error" className="mt-4">
            Link the number again with “Re-link”.
          </Banner>
        )}
      </Card>

      {s.state === 'qr' && (
        <Card title="Scan to link" description="On the phone: WhatsApp → Settings → Linked devices → Link a device.">
          {s.qr ? (
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG
                  value={s.qr}
                  size={256}
                  className="h-auto w-full max-w-64"
                  aria-label="WhatsApp link QR code"
                />
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-6 text-emerald-600">
              <Spinner className="size-6" label="Waiting for QR code" />
            </div>
          )}
        </Card>
      )}

      <Card title="Actions">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {(Object.keys(ACTIONS) as WaAction[]).map((a) => (
            <Button
              key={a}
              variant={a === 'takeover' && s.state === 'replaced' ? 'primary' : 'secondary'}
              onClick={() => {
                action.reset();
                setPending(a);
              }}
            >
              {ACTIONS[a].label}
            </Button>
          ))}
        </div>
      </Card>

      {pending && (
        <ConfirmModal
          open
          title={ACTIONS[pending].title}
          confirmLabel={ACTIONS[pending].label}
          danger={ACTIONS[pending].danger}
          loading={action.isPending}
          error={action.error ?? undefined}
          onConfirm={() => action.mutate(pending, { onSuccess: () => setPending(null) })}
          onClose={() => setPending(null)}
        >
          <p>{ACTIONS[pending].body}</p>
        </ConfirmModal>
      )}
    </div>
  );
}

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import type { WaState } from '@wa-team-inbox/shared';
import { useWaAction, useWaStatus, type WaAction } from '../api/queries';
import { Banner, EmptyState, PageHeader, StatusDot, stateTone } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog, ErrorState } from './adminUi';

export const WA_STATE_LABEL: Record<WaState, string> = {
  open: 'Connected',
  connecting: 'Connecting',
  qr: 'Waiting for QR scan',
  disconnected: 'Disconnected',
  logged_out: 'Logged out',
  replaced: 'Opened elsewhere',
  blocked: 'Blocked',
};

const ACTIONS: Record<
  WaAction,
  { label: string; title: string; body: string; danger: boolean; done: string }
> = {
  logout: {
    label: 'Log out',
    title: 'Log out of WhatsApp?',
    body: 'The linked device is removed from the phone. The team inbox stops receiving and sending messages until you link again. Message history is kept.',
    danger: true,
    done: 'Logged out of WhatsApp.',
  },
  relink: {
    label: 'Re-link',
    title: 'Re-link WhatsApp?',
    body: 'The current session is discarded and a new QR code is shown. Scan it from WhatsApp > Linked devices on the phone.',
    danger: true,
    done: 'Session reset — scan the new QR code.',
  },
  takeover: {
    label: 'Take over',
    title: 'Take over the session?',
    body: 'Another instance (e.g. WhatsApp Web on another computer) replaced this connection. Taking over reconnects here and disconnects the other one.',
    danger: false,
    done: 'Reconnecting here.',
  },
};

const LINK_ILLUSTRATION = '/illustrations/link-whatsapp.png';

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
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (wa.isError) return <ErrorState error={wa.error} onRetry={() => void wa.refetch()} />;

  const s = wa.data;
  const label = WA_STATE_LABEL[s.state] ?? s.state;
  const unlinked = s.state === 'logged_out' || s.state === 'blocked';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="WhatsApp" description="The WhatsApp number linked to this team inbox." />

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">Status</span>
            <StatusDot
              tone={stateTone(s.state)}
              pulse={s.state === 'connecting'}
              label={<span className="font-medium" data-testid="wa-state">{label}</span>}
            />
          </div>
          {s.me && (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Linked number</dt>
                <dd className="font-medium">{formatPhone(s.me.jid)}</dd>
              </div>
              {s.me.name && (
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{s.me.name}</dd>
                </div>
              )}
            </dl>
          )}
          {s.lastError && s.state !== 'open' && <Banner tone="warning">{s.lastError}</Banner>}
          {s.state === 'replaced' && (
            <Banner tone="danger" title="Session opened elsewhere">
              This number was connected from another place. Use “Take over” to reconnect here.
            </Banner>
          )}
          {unlinked && <Banner tone="danger">Link the number again with “Re-link”.</Banner>}
        </CardContent>
      </Card>

      {s.state === 'qr' && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>Scan to link</CardTitle>
            <CardDescription>On the phone: WhatsApp → Settings → Linked devices → Link a device.</CardDescription>
          </CardHeader>
          <CardContent>
            {s.qr ? (
              <div className="flex justify-center">
                {/* QR codes need a light quiet zone to scan reliably, even in dark mode. */}
                <div className="rounded-lg border bg-card p-3 dark:bg-foreground">
                  <QRCodeSVG
                    value={s.qr}
                    size={256}
                    bgColor="transparent"
                    fgColor="currentColor"
                    className="h-auto w-full max-w-64 text-foreground dark:text-background"
                    aria-label="WhatsApp link QR code"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                illustration={LINK_ILLUSTRATION}
                title="Waiting for QR code"
                description="A code appears here in a few seconds."
              />
            )}
          </CardContent>
        </Card>
      )}

      {unlinked && (
        <Card>
          <EmptyState
            illustration={LINK_ILLUSTRATION}
            title="Link WhatsApp"
            description="Re-link to show a new QR code, then scan it from the phone."
            action={
              <Button
                size="touch"
                className="md:min-h-9"
                onClick={() => {
                  action.reset();
                  setPending('relink');
                }}
              >
                Re-link
              </Button>
            }
          />
        </Card>
      )}

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {(Object.keys(ACTIONS) as WaAction[]).map((a) => (
              <Button
                key={a}
                size="touch"
                className="md:min-h-9"
                variant={
                  a === 'takeover' && s.state === 'replaced'
                    ? 'default'
                    : a === 'logout'
                      ? 'outline'
                      : 'secondary'
                }
                onClick={() => {
                  action.reset();
                  setPending(a);
                }}
              >
                {ACTIONS[a].label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {pending && (
        <ConfirmDialog
          open
          title={ACTIONS[pending].title}
          confirmLabel={ACTIONS[pending].label}
          danger={ACTIONS[pending].danger}
          loading={action.isPending}
          error={action.error ?? undefined}
          onConfirm={() =>
            action.mutate(pending, {
              onSuccess: () => {
                toast.success(ACTIONS[pending].done);
                setPending(null);
              },
            })
          }
          onClose={() => setPending(null)}
        >
          <p>{ACTIONS[pending].body}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

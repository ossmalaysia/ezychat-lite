import type React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, CircleCheck, Loader2, QrCode, Smartphone } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PhoneLink } from '../wa/PhoneLink';
import { errorMessage } from '../api/client';
import { useWaAction, useWaStatus } from '../api/queries';
import { Banner, StatusDot, stateTone } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ButtonSpinner } from '../auth/AuthShell';
import { formatJid } from '../lib/jid';

export interface WaLinkStepProps {
  onContinue?: () => void;
  onSkip?: () => void;
}

const STATE_LABEL: Record<string, string> = {
  open: 'Connected',
  qr: 'Waiting for scan',
  connecting: 'Connecting…',
  starting: 'Starting…',
  logged_out: 'Logged out',
  replaced: 'Opened elsewhere',
  blocked: 'Blocked',
  disconnected: 'Disconnected',
};

/** Shows the pairing QR (from wa status) until the number is linked. */
export function WaLinkStep({ onContinue, onSkip }: WaLinkStepProps) {
  const wa = useWaStatus();
  const action = useWaAction();
  const s = wa.data;

  let body: React.ReactNode;
  if (wa.isPending) {
    body = <Waiting text="Checking WhatsApp connection…" />;
  } else if (wa.error) {
    body = <Banner tone="danger">{errorMessage(wa.error)}</Banner>;
  } else if (s?.state === 'open') {
    body = (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm"
      >
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">WhatsApp linked</p>
          <p className="break-words text-muted-foreground">
            {s.me
              ? `Connected as ${s.me.name ? `${s.me.name} (${formatJid(s.me.jid)})` : formatJid(s.me.jid)}.`
              : 'Connected.'}
          </p>
        </div>
      </div>
    );
  } else if (s?.state === 'qr' && s.qr) {
    body = (
      <div className="flex flex-col items-center gap-3">
        <Card className="gap-0 p-3">
          <CardContent className="p-0">
            <QRCodeSVG
              value={s.qr}
              size={240}
              marginSize={1}
              className="h-auto w-[min(240px,70vw)] rounded-md"
              title="Pairing QR code"
            />
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">The code refreshes automatically.</p>
      </div>
    );
  } else if (
    s?.state === 'logged_out' ||
    s?.state === 'replaced' ||
    s?.state === 'blocked' ||
    s?.state === 'disconnected'
  ) {
    body = (
      <div className="flex flex-col gap-3">
        <Banner tone="warning" title={stateTitle(s.state)}>
          {s.lastError ?? 'Generate a new QR code to link this number.'}
        </Banner>
        {action.error && <Banner tone="danger">{errorMessage(action.error)}</Banner>}
        <Button
          variant="secondary"
          size="touch"
          aria-busy={action.isPending || undefined}
          disabled={action.isPending}
          onClick={() => action.mutate('relink')}
        >
          {action.isPending ? <ButtonSpinner /> : <QrCode aria-hidden="true" />}
          Show a new QR code
        </Button>
      </div>
    );
  } else {
    body = <Waiting text="Waiting for a QR code…" />;
  }

  const linked = s?.state === 'open';
  const linking = !wa.isPending && !wa.error && (s?.state === 'qr' || s?.state === 'connecting');
  if (linking) {
    body = (
      <Tabs defaultValue="qr" className="gap-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="qr" className="min-h-9">
            <QrCode aria-hidden="true" />
            QR code
          </TabsTrigger>
          <TabsTrigger value="phone" className="min-h-9">
            <Smartphone aria-hidden="true" />
            Phone number
          </TabsTrigger>
        </TabsList>
        <TabsContent value="qr">{body}</TabsContent>
        <TabsContent value="phone">
          <PhoneLink />
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Link your WhatsApp number</h2>
          {s?.state && (
            <StatusDot
              tone={stateTone(s.state)}
              pulse={s.state === 'qr' || s.state === 'connecting'}
              label={<span className="text-muted-foreground">{STATE_LABEL[s.state] ?? s.state}</span>}
            />
          )}
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Open WhatsApp on the phone with the business number.</li>
          <li>
            Go to <strong className="text-foreground">Settings → Linked devices → Link a device</strong>.
          </li>
          <li>Scan this QR code — or use the Phone number tab to link with a code instead.</li>
        </ol>
      </div>
      {body}
      <p className="text-xs text-muted-foreground">
        WA Team Inbox is not affiliated with WhatsApp or Meta. Unofficial clients can get numbers
        banned — avoid bulk messaging.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onSkip && !linked && (
          <Button variant="ghost" size="touch" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        {onContinue && (
          <Button size="touch" onClick={onContinue} disabled={!linked}>
            Continue
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function stateTitle(state: string): string {
  switch (state) {
    case 'logged_out':
      return 'WhatsApp was logged out';
    case 'replaced':
      return 'Session opened elsewhere';
    case 'blocked':
      return 'WhatsApp refused the connection';
    default:
      return 'WhatsApp is disconnected';
  }
}

function Waiting({ text }: { text: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export default WaLinkStep;

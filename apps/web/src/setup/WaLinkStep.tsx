import type React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { errorMessage } from '../api/client';
import { useWaAction, useWaStatus } from '../api/queries';
import { Banner, Button, Spinner } from '../components/legacy';
import { formatJid } from '../lib/jid';

export interface WaLinkStepProps {
  onContinue?: () => void;
  onSkip?: () => void;
}

/** Shows the pairing QR (from wa status) until the number is linked. */
export function WaLinkStep({ onContinue, onSkip }: WaLinkStepProps) {
  const wa = useWaStatus();
  const action = useWaAction();
  const s = wa.data;

  let body: React.ReactNode;
  if (wa.isPending) {
    body = <Waiting text="Checking WhatsApp connection…" />;
  } else if (wa.error) {
    body = <Banner tone="error">{errorMessage(wa.error)}</Banner>;
  } else if (s?.state === 'open') {
    body = (
      <Banner tone="success" title="WhatsApp linked">
        {s.me
          ? `Connected as ${s.me.name ? `${s.me.name} (${formatJid(s.me.jid)})` : formatJid(s.me.jid)}.`
          : 'Connected.'}
      </Banner>
    );
  } else if (s?.state === 'qr' && s.qr) {
    body = (
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200">
          <QRCodeSVG
            value={s.qr}
            size={240}
            marginSize={1}
            className="h-auto w-[min(240px,70vw)]"
            title="Pairing QR code"
          />
        </div>
        <p className="text-center text-xs text-neutral-500">The code refreshes automatically.</p>
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
        {action.error && <Banner tone="error">{errorMessage(action.error)}</Banner>}
        <Button
          variant="secondary"
          loading={action.isPending}
          onClick={() => action.mutate('relink')}
        >
          Show a new QR code
        </Button>
      </div>
    );
  } else {
    body = <Waiting text="Waiting for a QR code…" />;
  }

  const linked = s?.state === 'open';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          Link your WhatsApp number
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
          <li>Open WhatsApp on the phone with the business number.</li>
          <li>
            Go to <strong>Settings → Linked devices → Link a device</strong>.
          </li>
          <li>Point the phone at this QR code.</li>
        </ol>
      </div>
      {body}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        WA Team Inbox is not affiliated with WhatsApp or Meta. Unofficial clients can get numbers
        banned — avoid bulk messaging.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onSkip && !linked && (
          <Button variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        {onContinue && (
          <Button onClick={onContinue} disabled={!linked}>
            Continue
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
    <div className="flex flex-col items-center gap-3 py-8 text-emerald-600 dark:text-emerald-400">
      <Spinner className="size-8" />
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{text}</p>
    </div>
  );
}

export default WaLinkStep;

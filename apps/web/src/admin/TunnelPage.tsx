import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { QRCodeSVG } from 'qrcode.react';
import type { TunnelMode, TunnelState, TunnelStartBody } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import { useSettings, useStartTunnel, useStopTunnel, useTunnel } from '../api/queries';
import { Banner, Button, Card, Input, Spinner } from '../components/ui';
import { Badge, CopyButton, ErrorState, PageHeader, type BadgeTone } from './adminUi';

const STATE_META: Record<TunnelState, { label: string; tone: BadgeTone }> = {
  stopped: { label: 'Stopped', tone: 'neutral' },
  starting: { label: 'Starting', tone: 'info' },
  running: { label: 'Running', tone: 'success' },
  error: { label: 'Error', tone: 'error' },
};

const MODES: { value: TunnelMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Only this computer (and the LAN, if enabled).' },
  { value: 'quick', label: 'Quick', hint: 'Free random trycloudflare.com URL. No account needed.' },
  { value: 'named', label: 'Named', hint: 'Your own hostname via a Cloudflare tunnel token.' },
];

export function TunnelPage() {
  const tunnel = useTunnel();
  const settings = useSettings();
  const start = useStartTunnel();
  const stop = useStopTunnel();

  const [mode, setMode] = useState<TunnelMode>('off');
  const [token, setToken] = useState('');
  const [hostname, setHostname] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current || !tunnel.data) return;
    initialised.current = true;
    setMode(tunnel.data.mode);
    setHostname(tunnel.data.hostname ?? settings.data?.namedTunnelHostname ?? '');
  }, [tunnel.data, settings.data]);

  const savedHostname = settings.data?.namedTunnelHostname;
  useEffect(() => {
    if (savedHostname) setHostname((h) => h || savedHostname);
  }, [savedHostname]);

  if (tunnel.isPending)
    return (
      <div className="flex justify-center py-10 text-emerald-600">
        <Spinner className="size-6" />
      </div>
    );
  if (tunnel.isError) return <ErrorState error={tunnel.error} onRetry={() => void tunnel.refetch()} />;

  const s = tunnel.data;
  const meta = STATE_META[s.state];
  const active = s.state === 'running' || s.state === 'starting';
  const hasToken = settings.data?.hasTunnelToken ?? false;

  const onStart = () => {
    setFormError(null);
    if (mode === 'off') {
      stop.mutate();
      return;
    }
    const body: TunnelStartBody = { mode };
    if (mode === 'named') {
      const t = token.trim();
      if (t && t.length < 10) return setFormError('That token looks too short.');
      if (!t && !hasToken) return setFormError('Paste the tunnel token from the Cloudflare dashboard.');
      if (t) body.token = t;
      if (hostname.trim()) body.hostname = hostname.trim();
    }
    start.mutate(body, { onSuccess: () => setToken('') });
  };

  const mutationError = start.error ?? stop.error;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tunnel"
        description="Reach the inbox from phones anywhere through a Cloudflare tunnel."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-neutral-500">Status</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {s.mode !== 'off' && <span className="text-sm text-neutral-500">({s.mode})</span>}
        </div>

        {s.url && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 break-all text-sm font-medium text-emerald-700 underline dark:text-emerald-400"
              >
                {s.url}
              </a>
              <CopyButton text={s.url} label="Copy URL" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={s.url} size={200} className="h-auto w-full max-w-52" aria-label="Tunnel URL QR code" />
              </div>
              <p className="text-center text-xs text-neutral-500">Scan with a phone camera to open the inbox.</p>
            </div>
          </div>
        )}

        {s.mode === 'quick' && (
          <Banner tone="info" className="mt-4">
            Quick tunnel URLs change every time the tunnel or the app restarts. Use a named tunnel
            for a permanent address.
          </Banner>
        )}
        {s.lastError && (
          <Banner tone="error" className="mt-4" title="Last error">
            {s.lastError}
          </Banner>
        )}
      </Card>

      <Card title="Configure">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">Mode</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={clsx(
                  'flex min-h-11 cursor-pointer flex-col rounded-lg border p-3 text-sm',
                  mode === m.value
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                    : 'border-neutral-300 dark:border-neutral-700',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="tunnel-mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    className="size-4 accent-emerald-600"
                  />
                  {m.label}
                </span>
                <span className="mt-1 text-neutral-500">{m.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === 'named' && (
          <div className="mt-4 space-y-4">
            <Input
              label="Tunnel token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              placeholder={hasToken ? '•••••••• (saved — leave blank to keep)' : 'eyJh…'}
              hint="Cloudflare Zero Trust → Networks → Tunnels → your tunnel → install token."
            />
            <Input
              label="Public hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="inbox.example.com"
              autoCapitalize="none"
              autoCorrect="off"
              hint="The hostname routed to http://127.0.0.1:<port> in the tunnel config."
            />
          </div>
        )}

        {(formError || mutationError) && (
          <Banner tone="error" className="mt-4">
            {formError ?? errorMessage(mutationError)}
          </Banner>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button onClick={onStart} loading={start.isPending} disabled={mode === 'off' && !active}>
            {mode === 'off' ? 'Turn off' : active ? 'Restart tunnel' : 'Start tunnel'}
          </Button>
          {active && mode !== 'off' && (
            <Button variant="secondary" onClick={() => stop.mutate()} loading={stop.isPending}>
              Stop
            </Button>
          )}
        </div>
      </Card>

      {s.logTail.length > 0 && (
        <Card title="Log">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-neutral-950 p-3 font-mono text-xs text-neutral-100">
            {s.logTail.join('\n')}
          </pre>
        </Card>
      )}
    </div>
  );
}

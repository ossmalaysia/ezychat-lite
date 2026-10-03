import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { TunnelMode, TunnelState, TunnelStartBody } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import { useSettings, useStartTunnel, useStopTunnel, useTunnel } from '../api/queries';
import { Banner, PageHeader, StatusDot, stateTone } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyButton, ErrorState, Field, Pending } from './adminUi';
import { CloudflareSetup } from './CloudflareSetup';

const STATE_LABEL: Record<TunnelState, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  error: 'Error',
};

const MODES: { value: TunnelMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Only this computer (and the LAN, if enabled).' },
  {
    value: 'quick',
    label: 'Temporary link',
    hint: 'A free link that changes on restart. No account needed.',
  },
  {
    value: 'named',
    label: 'Your domain',
    hint: 'Sign in to Cloudflare and choose a permanent inbox address.',
  },
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (tunnel.isError)
    return <ErrorState error={tunnel.error} onRetry={() => void tunnel.refetch()} />;

  const s = tunnel.data;
  const active = s.state === 'running' || s.state === 'starting';
  const hasToken = settings.data?.hasTunnelToken ?? false;
  const pending = start.isPending || stop.isPending;
  const namedRunning = s.mode === 'named' && s.state === 'running' && s.hostname === savedHostname;
  const namedStarting =
    s.mode === 'named' && s.state === 'starting' && s.hostname === savedHostname;
  const actionLabel = {
    off: active ? 'Disconnect Cloudflare' : 'Remote access is off',
    named: namedStarting ? 'Connecting saved address…' : 'Connect saved address',
    quick: active ? 'Restart temporary link' : 'Create temporary link',
  }[mode];

  const onStart = (manual = false) => {
    setFormError(null);
    if (mode === 'off') {
      stop.mutate();
      return;
    }
    const body: TunnelStartBody = { mode };
    if (mode === 'named') {
      const t = manual ? token.trim() : '';
      if (t && t.length < 10) return setFormError('That token looks too short.');
      if (!t && !hasToken)
        return setFormError('Paste the tunnel token from the Cloudflare dashboard.');
      if (t) body.token = t;
      const h = manual ? hostname.trim() : savedHostname;
      if (h) body.hostname = h;
    }
    start.mutate(body, { onSuccess: () => setToken('') });
  };

  const mutationError = start.error ?? stop.error;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Cloudflare access"
        description="Give your team a link to open the inbox from phones anywhere."
      />

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Connection status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot
              tone={stateTone(s.state)}
              pulse={s.state === 'starting'}
              label={<span className="font-medium">{STATE_LABEL[s.state] ?? s.state}</span>}
            />
            {s.mode !== 'off' && (
              <span className="text-sm text-muted-foreground">
                ({MODES.find((m) => m.value === s.mode)?.label})
              </span>
            )}
          </div>

          {s.url && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-1 text-sm font-medium break-all text-primary underline underline-offset-4"
                >
                  <span className="min-w-0 break-all">{s.url}</span>
                  <ExternalLink className="size-4 shrink-0" aria-hidden />
                </a>
                <CopyButton text={s.url} label="Copy URL" />
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-lg border bg-card p-3 dark:bg-foreground">
                  <QRCodeSVG
                    value={s.url}
                    size={200}
                    bgColor="transparent"
                    fgColor="currentColor"
                    className="h-auto w-full max-w-52 text-foreground dark:text-background"
                    aria-label="Tunnel URL QR code"
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Scan with a phone camera to open the inbox.
                </p>
              </div>
            </div>
          )}

          {s.mode === 'quick' && (
            <Banner tone="info">
              Temporary links change every time the connection or the app restarts. Choose Your
              domain for a permanent inbox address.
            </Banner>
          )}
          {s.lastError && (
            <Banner tone="danger" title="Last error">
              {s.lastError}
            </Banner>
          )}
        </CardContent>
      </Card>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>How your team connects</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium">Remote access</legend>
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as TunnelMode);
                setFormError(null);
              }}
              className="grid gap-2 sm:grid-cols-3"
              aria-label="Remote access mode"
            >
              {MODES.map((m) => {
                const id = `tunnel-mode-${m.value}`;
                return (
                  <Label
                    key={m.value}
                    htmlFor={id}
                    className={cn(
                      'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 leading-normal transition-colors hover:bg-accent',
                      mode === m.value && 'border-primary bg-primary/5',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <RadioGroupItem id={id} value={m.value} />
                      {m.label}
                    </span>
                    <span className="font-normal text-muted-foreground">{m.hint}</span>
                  </Label>
                );
              })}
            </RadioGroup>
          </fieldset>

          {mode === 'named' && (
            <div className="flex flex-col gap-4">
              <CloudflareSetup tunnel={s} />
              <div className="border-t pt-4">
                <Button
                  variant="ghost"
                  size="touch"
                  aria-expanded={advancedOpen}
                  aria-controls="cloudflare-advanced"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  className="w-full justify-start whitespace-normal text-left"
                >
                  Advanced: use a tunnel token
                </Button>
                <div id="cloudflare-advanced" hidden={!advancedOpen}>
                  <div className="flex flex-col gap-4 pt-3">
                    <p className="text-sm text-muted-foreground">
                      For an existing tunnel configured in the Cloudflare dashboard. Guided sign-in
                      above handles this setup for you.
                    </p>
                    <Field
                      label="Tunnel token"
                      hint="Cloudflare Zero Trust → Networks → Tunnels → your tunnel → install token."
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="password"
                          className="h-11 font-mono md:h-9"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          autoComplete="off"
                          placeholder={
                            hasToken ? '•••••••• (saved — leave blank to keep)' : 'eyJh…'
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label="Public hostname"
                      hint="The hostname routed to http://127.0.0.1:<port> in the tunnel config."
                    >
                      {(p) => (
                        <Input
                          {...p}
                          className="h-11 md:h-9"
                          value={hostname}
                          onChange={(e) => setHostname(e.target.value)}
                          placeholder="inbox.example.com"
                          autoCapitalize="none"
                          autoCorrect="off"
                        />
                      )}
                    </Field>
                    <Button
                      size="touch"
                      variant="outline"
                      onClick={() => onStart(true)}
                      disabled={pending}
                    >
                      <Pending show={start.isPending} />
                      Connect with token
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(formError || mutationError) && (
            <Banner tone="danger">{formError ?? errorMessage(mutationError)}</Banner>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {(mode !== 'named' || (hasToken && !namedRunning)) && (
              <Button
                size="touch"
                className="md:min-h-9"
                onClick={() => onStart()}
                disabled={
                  pending || (mode === 'off' && !active) || (mode === 'named' && namedStarting)
                }
              >
                <Pending show={start.isPending} />
                {actionLabel}
              </Button>
            )}
            {active && mode !== 'off' && (
              <Button
                size="touch"
                variant="outline"
                className="md:min-h-9"
                onClick={() => stop.mutate()}
                disabled={pending}
              >
                <Pending show={stop.isPending} />
                Disconnect Cloudflare
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Disconnect Cloudflare stops the public link. The inbox still works on this computer
            {settings.data?.lanEnabled ? ' and over your enabled local network' : ''}. Messages and
            the saved domain are kept, so you can connect again later.
          </p>
        </CardContent>
      </Card>

      {s.logTail.length > 0 && (
        <details className="min-w-0 rounded-lg border bg-card p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
            Advanced: connection diagnostics
          </summary>
          <div className="pt-3">
            <ScrollArea
              className={cn('rounded-md border bg-muted', s.logTail.length > 14 && 'h-72')}
            >
              <pre className="p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
                {s.logTail.join('\n')}
              </pre>
            </ScrollArea>
          </div>
        </details>
      )}
    </div>
  );
}

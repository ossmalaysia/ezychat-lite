import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, PauseCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accessStatusSchema, type AccessStatus } from '@ezychat/shared';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { AuthShell, FullPageLoader } from '@/auth/AuthShell';
import { useWebExtensions, type WebExtensionLockScreenProps } from '@/extensions';
import { ACCESS_CLOSED_EVENT, ACCESS_RECHECK_EVENT, type AccessClosedDetail } from './events';

/** How often a closed gate reads GET /api/access again. */
export const ACCESS_POLL_MS = 60_000;
/** Rechecks asked for by the socket or the API are spaced at least this far apart. */
const RECHECK_MIN_GAP_MS = 5_000;

type GateState =
  | { status: 'loading' }
  | { status: 'open' }
  /** `confirmed`: GET /api/access said closed (not only a 403 from another call). */
  | { status: 'closed'; code: string; confirmed: boolean };

/**
 * GET /api/access without the shared API client (no 401/403 side effects). A server that does not
 * answer it (an older build, a network error) counts as open: the gate never locks anyone out by
 * itself; the server enforces access.
 */
export async function readAccessStatus(signal?: AbortSignal): Promise<AccessStatus | null> {
  try {
    const res = await fetch('/api/access', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    });
    if (!res.ok) return null;
    const parsed = accessStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function reloadPage(): void {
  window.location.reload();
}

/**
 * Shows the app while the server's access gate is open and a lock screen (the extension's, or the
 * core "paused" screen) while it is closed. It reads GET /api/access on start, every minute while
 * closed and whenever asked; API calls answering 403 with the gate code close it at once. When a
 * closed gate opens again the page reloads, so every query and the socket start fresh.
 */
export function AccessGate({
  children,
  reload = reloadPage,
}: {
  children: ReactNode;
  /** Called when a closed gate opens again; tests pass a spy. */
  reload?: () => void;
}) {
  const extensions = useWebExtensions();
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const stateRef = useRef<GateState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const lastCheck = useRef(0);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastCheck.current = Date.now();
    try {
      const status = await readAccessStatus();
      const current = stateRef.current;
      if (status && !status.open) {
        setState({ status: 'closed', code: status.code ?? 'access_closed', confirmed: true });
      } else if (current.status === 'closed' && current.confirmed) {
        // Reopened: start the whole app fresh. A failed read keeps the lock screen.
        if (status?.open) reload();
      } else if (current.status !== 'closed' || status?.open) {
        setState({ status: 'open' });
      }
    } finally {
      inFlight.current = false;
    }
  }, [reload]);

  useEffect(() => {
    void check();
    const onClosed = (event: Event) => {
      const code = (event as CustomEvent<AccessClosedDetail>).detail?.code;
      if (!code) return;
      setState((prev) =>
        prev.status === 'closed' ? prev : { status: 'closed', code, confirmed: false },
      );
      onRecheck();
    };
    const onRecheck = () => {
      if (Date.now() - lastCheck.current >= RECHECK_MIN_GAP_MS) void check();
    };
    window.addEventListener(ACCESS_CLOSED_EVENT, onClosed);
    window.addEventListener(ACCESS_RECHECK_EVENT, onRecheck);
    return () => {
      window.removeEventListener(ACCESS_CLOSED_EVENT, onClosed);
      window.removeEventListener(ACCESS_RECHECK_EVENT, onRecheck);
    };
  }, [check]);

  const closed = state.status === 'closed';
  useEffect(() => {
    if (!closed) return;
    const timer = setInterval(() => void check(), ACCESS_POLL_MS);
    return () => clearInterval(timer);
  }, [closed, check]);

  const recheck = useCallback(() => void check(), [check]);

  if (state.status === 'loading') return <FullPageLoader />;
  if (state.status === 'open') return <>{children}</>;

  const LockScreen = extensions.find((ext) => ext.lockScreen)?.lockScreen;
  const fallback = <PausedScreen code={state.code} recheck={recheck} />;
  return (
    <ErrorBoundary fallback={fallback}>
      {LockScreen ? <LockScreen code={state.code} recheck={recheck} /> : fallback}
    </ErrorBoundary>
  );
}

/** Core lock screen: the app is paused; WhatsApp keeps receiving messages meanwhile. */
export function PausedScreen({ code, recheck }: WebExtensionLockScreenProps) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => setChecking(false), 1_500);
    return () => clearTimeout(timer);
  }, [checking]);
  return (
    <AuthShell
      title={t('access.pausedTitle')}
      subtitle={t('access.pausedBody')}
      languageSelect={false}
    >
      <div className="flex flex-col items-center gap-4 text-center" data-testid="access-paused">
        <PauseCircle className="size-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t('access.autoCheck')}</p>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {t('access.code', { code })}
        </p>
        <Button
          size="touch"
          className="w-full"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            recheck();
          }}
        >
          {checking ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          {checking ? t('access.checking') : t('access.checkAgain')}
        </Button>
      </div>
    </AuthShell>
  );
}

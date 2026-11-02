import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { GoogleCalendarConnectProgress, GoogleCalendarConnectStart } from '@ezychat/shared';
import { errorMessage } from '../../api/client';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';

interface Signing {
  requestId: string;
  url: string;
  /** The browser blocked the new window: the person opens the link themselves. */
  blocked: boolean;
}

export interface GoogleConnectFlow {
  connect: () => void;
  cancel: () => void;
  signing: Signing | null;
  failed: GoogleCalendarConnectProgress['error'];
  starting: boolean;
  startError: Error | null;
  progressError: Error | null;
}

/**
 * Starts a Google sign-in of a core connector (Google Calendar, Google Sheets): a window opens
 * inside the click (so the browser allows it), then goes to Google's page once the server answers;
 * the page polls until Google sent the person back. The connector's own API hooks are passed in.
 */
export function useGoogleConnectFlow(options: {
  useStart: () => UseMutationResult<GoogleCalendarConnectStart, Error, void>;
  useProgress: (requestId: string | null) => UseQueryResult<GoogleCalendarConnectProgress>;
  statusKey: QueryKey;
  connectedToast: string;
}): GoogleConnectFlow {
  const qc = useQueryClient();
  const start = options.useStart();
  const [signing, setSigning] = useState<Signing | null>(null);
  const [failed, setFailed] = useState<GoogleCalendarConnectProgress['error']>(null);
  const progress = options.useProgress(signing?.requestId ?? null);
  const status = progress.data?.status;
  const error = progress.data?.error ?? null;
  const { statusKey, connectedToast } = options;

  useEffect(() => {
    if (!signing || !status || status === 'pending') return;
    setSigning(null);
    if (status === 'done') {
      setFailed(null);
      toast.success(connectedToast);
      void qc.invalidateQueries({ queryKey: statusKey });
    } else setFailed(error ?? 'error');
  }, [signing, status, error, qc, statusKey, connectedToast]);

  const connect = async () => {
    setFailed(null);
    const tab = window.open('about:blank', '_blank');
    try {
      const next = await start.mutateAsync();
      if (tab) {
        tab.opener = null;
        tab.location.href = next.authorizationUrl;
      }
      setSigning({ requestId: next.requestId, url: next.authorizationUrl, blocked: !tab });
    } catch {
      // The mutation error is shown on the card.
      tab?.close();
    }
  };

  return {
    connect: () => void connect(),
    cancel: () => setSigning(null),
    signing,
    failed,
    starting: start.isPending,
    startError: start.error,
    progressError: progress.error,
  };
}

/** While Google's sign-in is open, and what went wrong after it. */
export function GoogleSigningIn({ flow }: Readonly<{ flow: GoogleConnectFlow }>) {
  const { t } = useTranslation('admin');
  return (
    <>
      {flow.signing && (
        <div
          className="flex flex-col items-start gap-3 rounded-lg border px-3 py-3"
          role="status"
          data-testid="google-signing-in"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('connectors.gc.waiting')}
          </p>
          <p className="text-sm text-muted-foreground">
            {flow.signing.blocked ? t('connectors.gc.blocked') : t('connectors.gc.waitingHint')}
          </p>
          <Button asChild size="touch" variant={flow.signing.blocked ? 'default' : 'outline'}>
            <a href={flow.signing.url} target="_blank" rel="noopener noreferrer">
              {t('connectors.gc.openSignIn')}
              <ExternalLink aria-hidden />
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">{t('connectors.gc.sameComputer')}</p>
          <Button size="touch" variant="ghost" onClick={flow.cancel}>
            {t('connectors.gc.cancelSignIn')}
          </Button>
        </div>
      )}
      {flow.failed && <Banner tone="danger">{t(`connectors.gc.failed.${flow.failed}`)}</Banner>}
      {flow.startError && <Banner tone="danger">{errorMessage(flow.startError)}</Banner>}
      {flow.progressError && <Banner tone="danger">{errorMessage(flow.progressError)}</Banner>}
    </>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import type { GoogleSheetsStatus } from '@ezychat/shared';
import {
  googleSheetsKey,
  useGoogleSheets,
  useGoogleSheetsConnect,
  useGoogleSheetsDisconnect,
  useGoogleSheetsProgress,
} from '../../api/connectors';
import { Banner, StatusDot, type StatusTone } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, ErrorState, ListSkeleton, Pending } from '../adminUi';
import { GoogleSigningIn, useGoogleConnectFlow } from './google-connect';

const WHAT_KEYS = ['what1', 'what2', 'what3'] as const;

const TONE: Record<GoogleSheetsStatus['state'], StatusTone> = {
  connected: 'success',
  expired: 'warning',
  unavailable: 'warning',
  disconnected: 'muted',
  not_configured: 'muted',
};

/**
 * The Google account Google Sheets uses (one per install, its own sign-in): connect, its state and
 * Disconnect. Which spreadsheet each AI agent uses lives on the Settings tab.
 */
export function GoogleSheetsAccountCard({
  onOpenSettings,
}: Readonly<{ onOpenSettings?: () => void }>) {
  const { t } = useTranslation('admin');
  const query = useGoogleSheets();
  const flow = useGoogleConnectFlow({
    useStart: useGoogleSheetsConnect,
    useProgress: useGoogleSheetsProgress,
    statusKey: googleSheetsKey,
    connectedToast: t('connectors.gs.connectedToast'),
  });
  const disconnect = useGoogleSheetsDisconnect();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const data = query.data;
  const state = data?.state;

  const connectButton = (label: string, outline = false) => (
    <Button
      size="touch"
      variant={outline ? 'outline' : 'default'}
      className="self-start"
      disabled={flow.starting || flow.signing !== null}
      onClick={flow.connect}
    >
      {outline ? null : <Table2 aria-hidden />}
      <Pending show={flow.starting} />
      {label}
    </Button>
  );

  return (
    <Card data-testid="google-sheets-account">
      <CardHeader>
        <CardTitle>{t('connectors.gc.accountTitle')}</CardTitle>
        <CardDescription>{t('connectors.gs.accountDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending && <ListSkeleton rows={2} />}
        {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {state === 'not_configured' && (
          <Banner tone="info" title={t('connectors.gc.notConfiguredTitle')}>
            {t('connectors.gc.notConfiguredBody')}
          </Banner>
        )}
        {state === 'disconnected' && (
          <>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {WHAT_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {t(`connectors.gs.${key}`)}
                </li>
              ))}
            </ul>
            {!flow.signing && connectButton(t('connectors.gs.connect'))}
            <p className="text-sm text-muted-foreground">{t('connectors.gs.connectHint')}</p>
          </>
        )}
        {data && (state === 'connected' || state === 'expired' || state === 'unavailable') && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm text-muted-foreground">{t('connectors.gc.account')}</span>
                <span className="font-medium break-all">{data.account}</span>
              </div>
              <span className="flex items-center gap-2 text-sm">
                <StatusDot tone={TONE[state]} />
                {t(`connectors.gc.state.${state}`)}
              </span>
            </div>
            {state === 'expired' && (
              <Banner tone="warning" title={t('connectors.gc.expiredTitle')}>
                <span className="flex flex-col items-start gap-2">
                  {t('connectors.gs.expiredBody')}
                  {!flow.signing && connectButton(t('connectors.gc.signInAgain'), true)}
                </span>
              </Banner>
            )}
            {state === 'unavailable' && (
              <Banner tone="warning" title={t('connectors.gs.unavailableTitle')}>
                {t('connectors.gs.unavailableBody')}
              </Banner>
            )}
            <p className="text-sm text-muted-foreground">
              {t('connectors.gs.perAgent')}{' '}
              {onOpenSettings && (
                <Button
                  variant="link"
                  className="h-auto p-0 align-baseline"
                  onClick={onOpenSettings}
                >
                  {t('connectors.gc.openSettings')}
                </Button>
              )}
            </p>
            <Button
              size="touch"
              variant="outline"
              className="self-start"
              onClick={() => setConfirmDisconnect(true)}
            >
              {t('connectors.gc.disconnect')}
            </Button>
          </>
        )}
        <GoogleSigningIn flow={flow} />
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        title={t('connectors.gs.disconnectTitle')}
        confirmLabel={t('connectors.gc.disconnect')}
        danger
        loading={disconnect.isPending}
        error={disconnect.error}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => {
              setConfirmDisconnect(false);
              toast.success(t('connectors.gs.disconnected'));
            },
          })
        }
      >
        {t('connectors.gs.disconnectBody')}
      </ConfirmDialog>
    </Card>
  );
}

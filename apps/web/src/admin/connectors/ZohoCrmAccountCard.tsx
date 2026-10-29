import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ContactRound, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ZOHO_REGIONS,
  type ZohoCrmConnectProgress,
  type ZohoCrmStatus,
  type ZohoRegion,
} from '@ezychat/shared';
import { errorMessage } from '../../api/client';
import {
  useZohoCrm,
  useZohoCrmConnect,
  useZohoCrmDisconnect,
  useZohoCrmProgress,
  zohoCrmKey,
} from '../../api/zoho-crm';
import { Banner, StatusDot, type StatusTone } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog, ErrorState, ListSkeleton, Pending } from '../adminUi';
import { GoogleCalendarLink } from './connector-ui';

interface Signing {
  requestId: string;
  url: string;
  blocked: boolean;
}

const WHAT_KEYS = ['what1', 'what2', 'what3'] as const;

/** Catalog keys of the Zoho sites (a key cannot contain a dot). */
const REGION_KEY = {
  com: 'com',
  eu: 'eu',
  in: 'in',
  'com.au': 'comAu',
  jp: 'jp',
  ca: 'ca',
  sa: 'sa',
} as const satisfies Record<ZohoRegion, string>;

const TONE: Record<ZohoCrmStatus['state'], StatusTone> = {
  connected: 'success',
  expired: 'warning',
  unavailable: 'warning',
  disconnected: 'muted',
  not_configured: 'muted',
};

/** Zoho's sign-in, as Google Calendar's: a window opens in the click, then the page polls. */
function useConnectFlow() {
  const { t } = useTranslation('admin');
  const qc = useQueryClient();
  const start = useZohoCrmConnect();
  const [signing, setSigning] = useState<Signing | null>(null);
  const [failed, setFailed] = useState<ZohoCrmConnectProgress['error']>(null);
  const progress = useZohoCrmProgress(signing?.requestId ?? null);
  const status = progress.data?.status;
  const error = progress.data?.error ?? null;

  useEffect(() => {
    if (!signing || !status || status === 'pending') return;
    setSigning(null);
    if (status === 'done') {
      setFailed(null);
      toast.success(t('connectors.zoho.connectedToast'));
      void qc.invalidateQueries({ queryKey: zohoCrmKey });
    } else setFailed(error ?? 'error');
  }, [signing, status, error, qc, t]);

  const connect = async (region: ZohoRegion) => {
    setFailed(null);
    const tab = window.open('about:blank', '_blank');
    try {
      const next = await start.mutateAsync(region);
      if (tab) {
        tab.opener = null;
        tab.location.href = next.authorizationUrl;
      }
      setSigning({ requestId: next.requestId, url: next.authorizationUrl, blocked: !tab });
    } catch {
      tab?.close();
    }
  };

  return {
    connect: (region: ZohoRegion) => void connect(region),
    cancel: () => setSigning(null),
    signing,
    failed,
    starting: start.isPending,
    startError: start.error,
    progressError: progress.error,
  };
}

/**
 * The Zoho account EzyChat uses (one per install): the Zoho site (data centre), Connect, the
 * organisation, account and site, Open Zoho CRM and Disconnect. What each AI agent may do lives on
 * the Settings tab.
 */
export function ZohoCrmAccountCard({ onOpenSettings }: Readonly<{ onOpenSettings?: () => void }>) {
  const { t } = useTranslation('admin');
  const query = useZohoCrm();
  const flow = useConnectFlow();
  const disconnect = useZohoCrmDisconnect();
  const regionId = useId();
  const [region, setRegion] = useState<ZohoRegion>('com');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const data = query.data;
  const state = data?.state;

  const connectButton = (label: string, outline = false) => (
    <Button
      size="touch"
      variant={outline ? 'outline' : 'default'}
      className="self-start"
      disabled={flow.starting || flow.signing !== null}
      onClick={() => flow.connect(outline && data?.region ? data.region : region)}
    >
      {outline ? null : <ContactRound aria-hidden />}
      <Pending show={flow.starting} />
      {label}
    </Button>
  );

  return (
    <Card data-testid="zoho-crm-account">
      <CardHeader>
        <CardTitle>{t('connectors.zoho.accountTitle')}</CardTitle>
        <CardDescription>{t('connectors.zoho.accountDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending && <ListSkeleton rows={2} />}
        {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {state === 'not_configured' && (
          <Banner tone="info" title={t('connectors.zoho.notConfiguredTitle')}>
            {t('connectors.zoho.notConfiguredBody')}
          </Banner>
        )}
        {state === 'disconnected' && (
          <>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {WHAT_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {t(`connectors.zoho.${key}`)}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1">
              <Label htmlFor={regionId}>{t('connectors.zoho.region')}</Label>
              <Select value={region} onValueChange={(v) => setRegion(v as ZohoRegion)}>
                <SelectTrigger
                  id={regionId}
                  className="min-h-11 w-full sm:w-80"
                  data-testid="zoho-region"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ZOHO_REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`connectors.zoho.regions.${REGION_KEY[r]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{t('connectors.zoho.regionHint')}</p>
            </div>
            {!flow.signing && connectButton(t('connectors.zoho.connect'))}
            <p className="text-sm text-muted-foreground">{t('connectors.zoho.connectHint')}</p>
          </>
        )}
        {data && (state === 'connected' || state === 'expired' || state === 'unavailable') && (
          <>
            <dl className="flex flex-col divide-y rounded-lg border">
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-sm text-muted-foreground">{t('connectors.zoho.org')}</dt>
                  <dd className="font-medium break-words">{data.org ?? '—'}</dd>
                </div>
                <span className="flex items-center gap-2 text-sm">
                  <StatusDot tone={TONE[state]} />
                  {t(`connectors.zoho.state.${state}`)}
                </span>
              </div>
              {data.account && (
                <div className="flex flex-col gap-0.5 px-3 py-3">
                  <dt className="text-sm text-muted-foreground">{t('connectors.zoho.account')}</dt>
                  <dd className="break-all">{data.account}</dd>
                </div>
              )}
              {data.region && (
                <div className="flex flex-col gap-0.5 px-3 py-3">
                  <dt className="text-sm text-muted-foreground">{t('connectors.zoho.site')}</dt>
                  <dd>{t(`connectors.zoho.regions.${REGION_KEY[data.region]}`)}</dd>
                </div>
              )}
            </dl>
            {state === 'expired' && (
              <Banner tone="warning" title={t('connectors.zoho.expiredTitle')}>
                <span className="flex flex-col items-start gap-2">
                  {t('connectors.zoho.expiredBody')}
                  {!flow.signing && connectButton(t('connectors.zoho.signInAgain'), true)}
                </span>
              </Banner>
            )}
            {state === 'unavailable' && (
              <Banner tone="warning" title={t('connectors.zoho.unavailableTitle')}>
                {t('connectors.zoho.unavailableBody')}
              </Banner>
            )}
            <p className="text-sm text-muted-foreground">
              {t('connectors.zoho.perAgent')}{' '}
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
            <div className="flex flex-wrap items-center gap-2">
              {data.crmUrl && (
                <GoogleCalendarLink href={data.crmUrl} label={t('connectors.zoho.openZoho')} />
              )}
              <Button
                size="touch"
                variant="outline"
                className="self-start"
                onClick={() => setConfirmDisconnect(true)}
              >
                {t('connectors.zoho.disconnect')}
              </Button>
            </div>
          </>
        )}
        {flow.signing && (
          <div
            className="flex flex-col items-start gap-3 rounded-lg border px-3 py-3"
            role="status"
            data-testid="zoho-signing-in"
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('connectors.zoho.waiting')}
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
            <p className="text-sm text-muted-foreground">{t('connectors.zoho.sameComputer')}</p>
            <Button size="touch" variant="ghost" onClick={flow.cancel}>
              {t('connectors.gc.cancelSignIn')}
            </Button>
          </div>
        )}
        {flow.failed && <Banner tone="danger">{t(`connectors.zoho.failed.${flow.failed}`)}</Banner>}
        {flow.startError && <Banner tone="danger">{errorMessage(flow.startError)}</Banner>}
        {flow.progressError && <Banner tone="danger">{errorMessage(flow.progressError)}</Banner>}
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        title={t('connectors.zoho.disconnectTitle')}
        confirmLabel={t('connectors.zoho.disconnect')}
        danger
        loading={disconnect.isPending}
        error={disconnect.error}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => {
              setConfirmDisconnect(false);
              toast.success(t('connectors.zoho.disconnected'));
            },
          })
        }
      >
        {t('connectors.zoho.disconnectBody')}
      </ConfirmDialog>
    </Card>
  );
}

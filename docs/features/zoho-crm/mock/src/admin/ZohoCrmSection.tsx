import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, ContactRound, Search, ShieldCheck, UserPlus, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../api/client';
import {
  Banner,
  EmptyState,
  ResponsiveDialog,
  SegmentedControl,
  StatusDot,
} from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatRelative } from '@/lib/format';
import {
  crmFor,
  useZohoCrm,
  useZohoCrmAction,
  zohoCrmUrl,
  ZOHO_REGIONS,
  type AgentCrm,
  type ZohoRegion,
} from '@/mock/zohoCrm';
import { ConfirmDialog, Field, ListSkeleton, SaveBar } from './adminUi';
import { GoogleCalendarLink } from './ConnectorsGalleryPage';

const DEMO_ACCOUNT = 'aisyah@kopiapong.my';

/**
 * Proposed (zoho-crm): the Zoho account card on the connector's Overview. One Zoho account per
 * install; "Connect Zoho CRM" asks for the Zoho site (data centre) and opens Zoho's own sign-in (in
 * the mock: a stand-in consent dialog). Nothing to paste.
 */
export function ZohoCrmSection({ onOpenSettings }: Readonly<{ onOpenSettings?: () => void }>) {
  const { t } = useTranslation('admin');
  const query = useZohoCrm();
  const action = useZohoCrmAction();
  const mockId = useId();
  const regionId = useId();
  const [consent, setConsent] = useState(false);
  const [region, setRegion] = useState<ZohoRegion>('com');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const data = query.data;
  const state = data?.state ?? 'disconnected';
  const connect = () =>
    action.mutate(
      { kind: 'connect', region },
      {
        onSuccess: (next) => {
          setConsent(false);
          toast.success(t('mockZoho.connected', { org: next.org ?? '' }));
        },
      },
    );
  const tone = state === 'connected' ? 'success' : state === 'disconnected' ? 'muted' : 'warning';
  return (
    <Card data-testid="zoho-crm-account">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('mockZoho.accountTitle')}</CardTitle>
          <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
        </div>
        <CardDescription>{t('mockZoho.accountDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending && <ListSkeleton rows={2} />}
        {data && state === 'disconnected' && (
          <>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {(['what1', 'what2', 'what3'] as const).map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {t(`mockZoho.${key}`)}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1">
              <Label htmlFor={regionId}>{t('mockZoho.region')}</Label>
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
                      {t(`mockZoho.regions.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{t('mockZoho.regionHint')}</p>
            </div>
            <Button size="touch" className="self-start" onClick={() => setConsent(true)}>
              <ContactRound aria-hidden />
              {t('mockZoho.connect')}
            </Button>
            <p className="text-sm text-muted-foreground">{t('mockZoho.connectHint')}</p>
          </>
        )}
        {data && state !== 'disconnected' && (
          <>
            <dl className="flex flex-col divide-y rounded-lg border">
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-sm text-muted-foreground">{t('mockZoho.org')}</dt>
                  <dd className="font-medium break-words">{data.org}</dd>
                </div>
                <span className="flex items-center gap-2 text-sm">
                  <StatusDot tone={tone} />
                  {t(`mockZoho.state.${state}`)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-3">
                <dt className="text-sm text-muted-foreground">{t('mockZoho.account')}</dt>
                <dd className="break-all">{data.account}</dd>
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-3">
                <dt className="text-sm text-muted-foreground">{t('mockZoho.site')}</dt>
                <dd>{data.region && t(`mockZoho.regions.${data.region}`)}</dd>
              </div>
            </dl>
            {state === 'expired' && (
              <Banner tone="warning" title={t('mockZoho.expiredTitle')}>
                <span className="flex flex-col items-start gap-2">
                  {t('mockZoho.expiredBody')}
                  <Button size="touch" variant="outline" onClick={() => setConsent(true)}>
                    {t('mockZoho.signInAgain')}
                  </Button>
                </span>
              </Banner>
            )}
            {state === 'unavailable' && (
              <Banner tone="warning" title={t('mockZoho.unavailableTitle')}>
                {t('mockZoho.unavailableBody')}
              </Banner>
            )}
            <p className="text-sm text-muted-foreground">
              {t('mockZoho.perAgent')}{' '}
              {onOpenSettings && (
                <Button
                  variant="link"
                  className="h-auto p-0 align-baseline"
                  onClick={onOpenSettings}
                >
                  {t('mockZoho.openSettings')}
                </Button>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {data.region && (
                <GoogleCalendarLink href={zohoCrmUrl(data.region)} label={t('mockZoho.openZoho')} />
              )}
              <Button size="touch" variant="outline" onClick={() => setConfirmDisconnect(true)}>
                {t('mockZoho.disconnect')}
              </Button>
            </div>
          </>
        )}
        {action.error && <Banner tone="danger">{errorMessage(action.error)}</Banner>}
        {data && state !== 'disconnected' && (
          <div
            className="flex flex-col gap-3 rounded-lg border border-dashed px-3 py-3"
            data-testid="mock-zoho-controls"
          >
            <Badge variant="outline" className="self-start">
              {t('mockSuggest.mockControls')}
            </Badge>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span id={mockId} className="text-sm font-medium">
                {t('mockZoho.mockZoho')}
              </span>
              <SegmentedControl<'connected' | 'expired' | 'unavailable'>
                size="sm"
                aria-labelledby={mockId}
                value={state}
                onValueChange={(next) => action.mutate({ kind: 'state', state: next })}
                options={[
                  { value: 'connected', label: t('mockZoho.mockOk') },
                  { value: 'expired', label: t('mockZoho.mockExpired') },
                  { value: 'unavailable', label: t('mockZoho.mockDown') },
                ]}
              />
            </div>
          </div>
        )}
      </CardContent>
      <ResponsiveDialog
        open={consent}
        onOpenChange={setConsent}
        title={t('mockZoho.consentTitle')}
        description={t('mockZoho.consentMock')}
        footer={
          <>
            <Button size="touch" variant="outline" onClick={() => setConsent(false)}>
              {t('mockZoho.consentCancel')}
            </Button>
            <Button size="touch" disabled={action.isPending} onClick={connect}>
              {t('mockZoho.consentAllow')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 pb-2 text-sm" data-testid="zoho-consent">
          <p>
            {t('mockZoho.consentAccount')}{' '}
            <span className="font-medium break-all">{DEMO_ACCOUNT}</span> ·{' '}
            {t(`mockZoho.regions.${data?.region ?? region}`)}
          </p>
          <p className="font-medium">{t('mockZoho.consentWants')}</p>
          <ul className="flex flex-col gap-1.5">
            {(['scope1', 'scope2', 'scope3'] as const).map((key) => (
              <li key={key} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {t(`mockZoho.${key}`)}
              </li>
            ))}
          </ul>
        </div>
      </ResponsiveDialog>
      <ConfirmDialog
        open={confirmDisconnect}
        title={t('mockZoho.disconnectTitle')}
        confirmLabel={t('mockZoho.disconnect')}
        danger
        loading={action.isPending}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() =>
          action.mutate(
            { kind: 'disconnect' },
            {
              onSuccess: () => {
                setConfirmDisconnect(false);
                toast.success(t('mockZoho.disconnected'));
              },
            },
          )
        }
      >
        {t('mockZoho.disconnectBody')}
      </ConfirmDialog>
    </Card>
  );
}

/**
 * Proposed (zoho-crm): Settings tab, one AI agent: Find the customer (on), Add new leads (off,
 * "Changes Zoho CRM"), lead owner, Lead Source, the one-line request summary and the rules the
 * server enforces.
 */
export function AgentZohoCrmCard({ agentId, name }: Readonly<{ agentId: string; name: string }>) {
  const { t } = useTranslation('admin');
  const query = useZohoCrm();
  const action = useZohoCrmAction();
  const saved = crmFor(query.data, agentId);
  const [draft, setDraft] = useState<AgentCrm>();
  const value = draft ?? saved;
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<AgentCrm>) => setDraft({ ...value, ...patch });
  const ids = { find: useId(), add: useId(), request: useId() };
  const state = query.data?.state ?? 'disconnected';
  const save = () =>
    action.mutate(
      { kind: 'agent', agentId, crm: value },
      {
        onSuccess: () => {
          setDraft(undefined);
          toast.success(t('mockZoho.saved'));
        },
      },
    );
  const row = (
    id: string,
    label: string,
    hint: string,
    checked: boolean,
    onChange: (on: boolean) => void,
    opts: { badge?: string; disabled?: boolean } = {},
  ) => (
    <div className="flex items-start justify-between gap-4 px-3 py-3">
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id}>{label}</Label>
          {opts.badge && <Badge variant="secondary">{opts.badge}</Badge>}
        </span>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <Label htmlFor={id} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <Switch id={id} checked={checked} disabled={opts.disabled} onCheckedChange={onChange} />
      </Label>
    </div>
  );
  return (
    <Card className="gap-4" data-testid="agent-zoho-crm">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <ContactRound className="size-5 text-muted-foreground" aria-hidden />
            {t('mockZoho.agentTitle')}
          </CardTitle>
          <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
        </div>
        <CardDescription>{t('mockZoho.agentDescription', { name })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {query.data && state === 'disconnected' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t('mockZoho.agentNotConnected')}</p>
            <Button asChild size="touch">
              <Link to="/admin/connectors/zoho-crm">{t('mockZoho.connect')}</Link>
            </Button>
          </div>
        )}
        {query.data && state !== 'disconnected' && (
          <>
            {state !== 'connected' && (
              <Banner tone="warning" title={t(`mockZoho.state.${state}`)}>
                {t('mockZoho.agentPaused', { name })}
              </Banner>
            )}
            <div className="flex flex-col divide-y rounded-lg border">
              {row(ids.find, t('mockZoho.find'), t('mockZoho.findHint'), value.find, (find) =>
                set({ find, addLeads: find ? value.addLeads : false }),
              )}
              {row(
                ids.add,
                t('mockZoho.addLeads'),
                value.find ? t('mockZoho.addLeadsHint') : t('mockZoho.needsFind'),
                value.addLeads,
                (addLeads) => set({ addLeads }),
                { badge: t('mockZoho.changesBadge'), disabled: !value.find },
              )}
            </div>
            {value.addLeads && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('mockZoho.owner')} hint={t('mockZoho.ownerHint')}>
                    {(p) => (
                      <Select value={value.ownerId} onValueChange={(ownerId) => set({ ownerId })}>
                        <SelectTrigger
                          {...p}
                          className="min-h-11 w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">
                            {t('mockZoho.ownerDefault', { account: query.data.account ?? '' })}
                          </SelectItem>
                          {query.data.users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                  <Field label={t('mockZoho.leadSource')} hint={t('mockZoho.leadSourceHint')}>
                    {(p) => (
                      <Input
                        {...p}
                        value={value.leadSource}
                        maxLength={40}
                        className="min-h-11"
                        onChange={(e) => set({ leadSource: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <div className="rounded-lg border">
                  {row(
                    ids.request,
                    t('mockZoho.includeRequest'),
                    t('mockZoho.includeRequestHint'),
                    value.includeRequest,
                    (includeRequest) => set({ includeRequest }),
                  )}
                </div>
              </>
            )}
            <div className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">{t('mockZoho.rulesTitle')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t('mockZoho.rule1')}</li>
                <li>{t('mockZoho.rule2')}</li>
                <li>{t('mockZoho.rule3')}</li>
                <li>{t('mockZoho.rule4')}</li>
              </ul>
            </div>
            {action.error && <Banner tone="danger">{errorMessage(action.error)}</Banner>}
            <SaveBar dirty={dirty}>
              <Button
                size="touch"
                disabled={!dirty || !value.leadSource.trim() || action.isPending}
                onClick={save}
              >
                {t('mockZoho.save')}
              </Button>
            </SaveBar>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Activity tab: what the AI looked up and added (who and when, never the chat text). */
export function ZohoCrmActivity() {
  const { t } = useTranslation('admin');
  const rows = useZohoCrm().data?.activity ?? [];
  if (rows.length === 0) return <EmptyState title={t('mockConnectors.activityEmpty')} />;
  return (
    <Card className="gap-3" data-testid="zoho-activity">
      <CardHeader>
        <CardTitle>{t('mockConnectors.activityTitle')}</CardTitle>
        <CardDescription>{t('mockZoho.activityHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {rows.map((r) => {
            const Icon =
              r.kind === 'added' || r.kind === 'added_by_team'
                ? UserPlus
                : r.kind === 'not_added'
                  ? UserRound
                  : Search;
            return (
              <li key={`${r.at}-${r.kind}`} className="flex items-start gap-3 py-3 first:pt-0">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm break-words">
                    {t(`mockZoho.act.${r.kind}`, {
                      agent: r.agent,
                      customer: r.customer,
                      module: r.module ? t(`mockZoho.module.${r.module}`) : '',
                      reason: r.reason ? t(`mockZoho.reason.${r.reason}`) : '',
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatRelative(r.at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContactRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  ZOHO_LEAD_SOURCE_CHARACTERS,
  ZohoCrmAgentSettings,
  type ZohoCrmStatus,
} from '@ezychat/shared';
import { errorMessage } from '../../api/client';
import { useSaveZohoCrmSettings, useZohoCrmSettings } from '../../api/zoho-crm';
import { Banner } from '@/components/app';
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
import { ErrorState, Field, ListSkeleton, Pending, SaveBar } from '../adminUi';

/** The Select value of "Zoho default" (the API's `ownerId: null`). */
const DEFAULT_OWNER = 'default';

/**
 * Connectors → Zoho CRM → Settings, for one AI agent: Find the customer (on by default), Add new
 * leads (off until an admin turns it on), and for new leads the owner, Lead Source and the one-line
 * request summary; the rules the server enforces.
 */
export function ZohoCrmSettingsCard({
  agentId,
  name,
  status,
  onConnect,
}: Readonly<{
  agentId: number;
  name: string;
  status: ZohoCrmStatus;
  onConnect: () => void;
}>) {
  const { t } = useTranslation('admin');
  const connected = status.state !== 'disconnected' && status.state !== 'not_configured';
  const query = useZohoCrmSettings(agentId, connected);
  const save = useSaveZohoCrmSettings(agentId);
  const [draft, setDraft] = useState<ZohoCrmAgentSettings>();
  const [sourceError, setSourceError] = useState<string>();
  const ids = { find: useId(), add: useId(), request: useId() };
  const saved = query.data;
  const value = draft ?? saved;
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<ZohoCrmAgentSettings>) => {
    if (value) setDraft({ ...value, ...patch });
  };
  // A saved owner who left Zoho is still shown, so the Select never looks empty.
  const users =
    value?.ownerId && !status.users.some((u) => u.id === value.ownerId)
      ? [...status.users, { id: value.ownerId, name: value.ownerId }]
      : status.users;

  const submit = () => {
    if (!value) return;
    const parsed = ZohoCrmAgentSettings.safeParse(value);
    setSourceError(value.leadSource.trim() ? undefined : t('connectors.zoho.leadSourceRequired'));
    if (!parsed.success) return;
    save.mutate(parsed.data, {
      onSuccess: () => {
        setDraft(undefined);
        toast.success(t('connectors.zoho.saved'));
      },
    });
  };

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
        <CardTitle className="flex items-center gap-2">
          <ContactRound className="size-5 text-muted-foreground" aria-hidden />
          {t('connectors.items.zoho-crm.name')}
        </CardTitle>
        <CardDescription>{t('connectors.zoho.agentDescription', { name })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!connected && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              {status.state === 'not_configured'
                ? t('connectors.zoho.notConfiguredBody')
                : t('connectors.zoho.agentNotConnected')}
            </p>
            {status.state === 'disconnected' && (
              <Button size="touch" onClick={onConnect}>
                {t('connectors.zoho.connect')}
              </Button>
            )}
          </div>
        )}
        {connected && query.isPending && <ListSkeleton rows={3} />}
        {connected && query.error && (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
        {connected && value && (
          <>
            {(status.state === 'expired' || status.state === 'unavailable') && (
              <Banner tone="warning" title={t(`connectors.zoho.state.${status.state}`)}>
                {t('connectors.zoho.agentPaused', { name })}{' '}
                <Button variant="link" className="h-auto p-0 align-baseline" onClick={onConnect}>
                  {t('connectors.booking.openAccount')}
                </Button>
              </Banner>
            )}
            <div className="flex flex-col divide-y rounded-lg border">
              {row(
                ids.find,
                t('connectors.tools.findCustomer'),
                t('connectors.zoho.findHint'),
                value.find,
                (find) => set({ find, addLeads: find ? value.addLeads : false }),
              )}
              {row(
                ids.add,
                t('connectors.zoho.addLeads'),
                value.find ? t('connectors.zoho.addLeadsHint') : t('connectors.zoho.needsFind'),
                value.addLeads,
                (addLeads) => set({ addLeads }),
                { badge: t('connectors.zoho.changesBadge'), disabled: !value.find },
              )}
            </div>
            {value.addLeads && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('connectors.zoho.owner')} hint={t('connectors.zoho.ownerHint')}>
                    {(p) => (
                      <Select
                        value={value.ownerId ?? DEFAULT_OWNER}
                        onValueChange={(v) => set({ ownerId: v === DEFAULT_OWNER ? null : v })}
                      >
                        <SelectTrigger
                          {...p}
                          className="min-h-11 w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
                          data-testid="zoho-owner"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_OWNER}>
                            {status.account
                              ? t('connectors.zoho.ownerDefault', { account: status.account })
                              : t('connectors.zoho.ownerDefaultNoAccount')}
                          </SelectItem>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                  <Field
                    label={t('connectors.zoho.leadSource')}
                    hint={t('connectors.zoho.leadSourceHint')}
                    error={sourceError}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={value.leadSource}
                        maxLength={ZOHO_LEAD_SOURCE_CHARACTERS}
                        className="min-h-11"
                        onChange={(e) => set({ leadSource: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <div className="rounded-lg border">
                  {row(
                    ids.request,
                    t('connectors.zoho.includeRequest'),
                    t('connectors.zoho.includeRequestHint'),
                    value.includeRequest,
                    (includeRequest) => set({ includeRequest }),
                  )}
                </div>
              </>
            )}
            <div className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">{t('connectors.zoho.rulesTitle')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t('connectors.zoho.rule1')}</li>
                <li>{t('connectors.zoho.rule2')}</li>
                <li>{t('connectors.zoho.rule3')}</li>
                <li>{t('connectors.zoho.rule4')}</li>
              </ul>
            </div>
            {save.error && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
            <SaveBar dirty={dirty} inset="card">
              <Button size="touch" disabled={!dirty || save.isPending} onClick={submit}>
                <Pending show={save.isPending} />
                {t('connectors.zoho.save')}
              </Button>
            </SaveBar>
          </>
        )}
      </CardContent>
    </Card>
  );
}

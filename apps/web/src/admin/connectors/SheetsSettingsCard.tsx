import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SheetsAgentSettings,
  googleSheetUrl,
  type GoogleSheetsStatus,
  type SpreadsheetInfo,
} from '@ezychat/shared';
import { errorMessage } from '../../api/client';
import {
  useSaveSheetsSettings,
  useSheetsSettings,
  useSpreadsheetLookup,
} from '../../api/connectors';
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
import {
  ErrorState,
  Field,
  ListSkeleton,
  Pending,
  SaveBar,
  type FieldControlProps,
} from '../adminUi';

type FieldErrors = Partial<Record<'link' | 'lookupTab' | 'leadsTab', string>>;
const RULES = ['rule1', 'rule2', 'rule3', 'rule4'] as const;
/** Test ids of the two tab choices. */
const TAB_TEST_IDS = { lookup: 'sheets-lookup-tab', leads: 'sheets-leads-tab' } as const;

/**
 * Connectors → Google Sheets → Settings, for one AI agent: the spreadsheet (a pasted link, checked
 * with Google), Read rows with its tab (on by default) and Add leads with its tab (off until an
 * admin turns it on).
 */
export function SheetsSettingsCard({
  agentId,
  name,
  status,
  onConnect,
}: Readonly<{
  agentId: number;
  name: string;
  status: GoogleSheetsStatus;
  /** Shows the account card (Overview tab) to connect. */
  onConnect: () => void;
}>) {
  const { t } = useTranslation('admin');
  const connected = status.state !== 'disconnected' && status.state !== 'not_configured';
  const query = useSheetsSettings(agentId, connected);
  const save = useSaveSheetsSettings(agentId);
  const lookup = useSpreadsheetLookup();
  const [draft, setDraft] = useState<SheetsAgentSettings>();
  const [link, setLink] = useState('');
  const [info, setInfo] = useState<SpreadsheetInfo | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const ids = { read: useId(), leads: useId() };
  const saved = query.data;
  const value = draft ?? saved;
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<SheetsAgentSettings>) => {
    if (value) setDraft({ ...value, ...patch });
  };

  // The saved spreadsheet's tabs, read once from Google (the tab choices need them).
  const savedId = saved?.spreadsheetId ?? null;
  const { mutate: find } = lookup;
  useEffect(() => {
    if (savedId && connected) find(savedId, { onSuccess: setInfo });
  }, [savedId, connected, find]);

  const choose = () => {
    if (!value || !link.trim()) {
      setErrors({ link: t('connectors.sheets.linkRequired') });
      return;
    }
    setErrors({});
    lookup.mutate(link.trim(), {
      onSuccess: (found) => {
        setInfo(found);
        setLink('');
        const has = (tab: string | null) => !!tab && found.tabs.some((x) => x.title === tab);
        const first = found.tabs[0]?.title ?? null;
        set({
          spreadsheetId: found.id,
          spreadsheetName: found.name,
          lookupTab: has(value.lookupTab) ? value.lookupTab : first,
          leadsTab: has(value.leadsTab) ? value.leadsTab : null,
        });
      },
    });
  };

  const submit = () => {
    if (!value) return;
    const next: FieldErrors = {};
    if (value.spreadsheetId && value.lookup && !value.lookupTab)
      next.lookupTab = t('connectors.sheets.tabRequired');
    if (value.addLeads && !value.leadsTab) next.leadsTab = t('connectors.sheets.tabRequired');
    if (!value.spreadsheetId && value.addLeads) next.link = t('connectors.sheets.linkRequired');
    setErrors(next);
    const parsed = SheetsAgentSettings.safeParse(value);
    if (Object.keys(next).length > 0 || !parsed.success) return;
    save.mutate(parsed.data, {
      onSuccess: () => {
        setDraft(undefined);
        toast.success(t('connectors.sheets.saved'));
      },
    });
  };

  const tabs = info && value && info.id === value.spreadsheetId ? info.tabs : [];
  const tabSelect = (
    current: string | null,
    onChange: (tab: string) => void,
    testId: string,
    p: FieldControlProps,
  ) => (
    <Select value={current ?? ''} onValueChange={onChange} disabled={tabs.length === 0}>
      <SelectTrigger
        {...p}
        className="min-h-11 w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
        data-testid={testId}
      >
        <SelectValue placeholder={t('connectors.sheets.chooseTab')} />
      </SelectTrigger>
      <SelectContent>
        {/* A saved tab Google no longer lists stays visible until it is changed. */}
        {current && !tabs.some((x) => x.title === current) && (
          <SelectItem value={current}>{current}</SelectItem>
        )}
        {tabs.map((tab) => (
          <SelectItem key={tab.title} value={tab.title}>
            {tab.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Card className="gap-4" data-testid="agent-sheets">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Table2 className="size-5 text-muted-foreground" aria-hidden />
          {t('connectors.sheets.title')}
        </CardTitle>
        <CardDescription>{t('connectors.sheets.description', { name })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!connected && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              {status.state === 'not_configured'
                ? t('connectors.gc.notConfiguredBody')
                : t('connectors.sheets.notConnected')}
            </p>
            {status.state === 'disconnected' && (
              <Button size="touch" onClick={onConnect}>
                {t('connectors.gs.connect')}
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
              <Banner tone="warning" title={t(`connectors.sheets.paused.${status.state}`)}>
                {t('connectors.sheets.pausedBody', { name })}{' '}
                <Button variant="link" className="h-auto p-0 align-baseline" onClick={onConnect}>
                  {t('connectors.booking.openAccount')}
                </Button>
              </Banner>
            )}

            <div className="flex flex-col gap-3">
              {value.spreadsheetId && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3"
                  data-testid="sheets-chosen"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-muted-foreground">
                      {t('connectors.sheets.spreadsheet')}
                    </span>
                    <span className="font-medium break-words">
                      {value.spreadsheetName ?? info?.name ?? value.spreadsheetId}
                    </span>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="min-h-9 pointer-coarse:min-h-11"
                  >
                    <a
                      href={googleSheetUrl(value.spreadsheetId)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('connectors.sheets.open')}
                      <ExternalLink aria-hidden />
                    </a>
                  </Button>
                </div>
              )}
              <Field
                label={
                  value.spreadsheetId
                    ? t('connectors.sheets.changeLink')
                    : t('connectors.sheets.link')
                }
                hint={t('connectors.sheets.linkHint')}
                error={errors.link}
              >
                {(p) => (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      {...p}
                      value={link}
                      inputMode="url"
                      placeholder={t('connectors.sheets.linkPlaceholder')}
                      className="min-h-11 min-w-0 flex-1"
                      data-testid="sheets-link"
                      onChange={(e) => setLink(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          choose();
                        }
                      }}
                    />
                    <Button
                      size="touch"
                      variant="outline"
                      disabled={lookup.isPending}
                      onClick={choose}
                      data-testid="sheets-find"
                    >
                      <Pending show={lookup.isPending} />
                      {t('connectors.sheets.find')}
                    </Button>
                  </div>
                )}
              </Field>
              {lookup.error && <Banner tone="danger">{errorMessage(lookup.error)}</Banner>}
            </div>

            <div className="flex flex-col divide-y rounded-lg border">
              <div className="flex flex-col gap-3 px-3 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Label htmlFor={ids.read}>{t('connectors.tools.readRows')}</Label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('connectors.sheets.readHint')}
                    </p>
                  </div>
                  <Label
                    htmlFor={ids.read}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
                  >
                    <Switch
                      id={ids.read}
                      checked={value.lookup}
                      onCheckedChange={(lookupOn) => set({ lookup: lookupOn })}
                    />
                  </Label>
                </div>
                {value.lookup && value.spreadsheetId && (
                  <Field label={t('connectors.sheets.lookupTab')} error={errors.lookupTab}>
                    {(p) =>
                      tabSelect(
                        value.lookupTab,
                        (lookupTab) => set({ lookupTab }),
                        TAB_TEST_IDS.lookup,
                        p,
                      )
                    }
                  </Field>
                )}
              </div>
              <div className="flex flex-col gap-3 px-3 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={ids.leads}>{t('connectors.tools.addLead')}</Label>
                      <Badge variant="secondary">{t('connectors.sheets.changesSheet')}</Badge>
                    </span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('connectors.sheets.leadsHint')}
                    </p>
                  </div>
                  <Label
                    htmlFor={ids.leads}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
                  >
                    <Switch
                      id={ids.leads}
                      checked={value.addLeads}
                      disabled={!value.spreadsheetId}
                      onCheckedChange={(addLeads) => set({ addLeads })}
                    />
                  </Label>
                </div>
                {value.addLeads && value.spreadsheetId && (
                  <Field
                    label={t('connectors.sheets.leadsTab')}
                    hint={t('connectors.sheets.leadsTabHint')}
                    error={errors.leadsTab}
                  >
                    {(p) =>
                      tabSelect(
                        value.leadsTab,
                        (leadsTab) => set({ leadsTab }),
                        TAB_TEST_IDS.leads,
                        p,
                      )
                    }
                  </Field>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">
                {t('connectors.sheets.rulesTitle')}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {RULES.map((key) => (
                  <li key={key}>{t(`connectors.sheets.${key}`)}</li>
                ))}
              </ul>
            </div>
            {save.error && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
            <SaveBar dirty={dirty} inset="card">
              <Button size="touch" disabled={!dirty || save.isPending} onClick={submit}>
                <Pending show={save.isPending} />
                {t('connectors.sheets.save')}
              </Button>
            </SaveBar>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { Ban, FileWarning, Lock, MessageSquareWarning, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader, SegmentedControl } from '@/components/app';
import { InfoTip } from '@/components/app/InfoTip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api/client';
import { useMockEdition } from '../mock/edition';
import {
  useSafety,
  useSafetyAction,
  useSafetySettings,
  useSimulate,
  type SafetyItem,
  type SafetyLevel,
  type SafetySettings,
} from '../mock/safety';
import { ConfirmDialog, ErrorState, ListSkeleton } from './adminUi';

/**
 * Proposed (whatsapp-safety): Admin → Safety. What WhatsApp Safety flagged (who sent it, why, who on
 * the team downloaded it), the blocked numbers, and the settings. Admins only, every inbox.
 */
export function SafetyPage() {
  const { t } = useTranslation('admin');
  const { data, error, refetch, isLoading } = useSafety();
  const [tab, setTab] = useState('flagged');
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const open = data?.items.filter((i) => i.status === 'open') ?? [];
  const locked = data?.items.filter((i) => i.quarantined && !i.released && !i.deleted) ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="safety-page">
      <PageHeader
        className="pb-0"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t('mockSafety.title')}
            <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
          </span>
        }
        description={t('mockSafety.description')}
      />
      {isLoading || !data ? (
        <ListSkeleton />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2" data-testid="safety-stats">
            {(
              [
                ['toReview', open.length],
                ['filesLocked', locked.length],
                ['blocked', data.blocked.length],
              ] as const
            ).map(([key, count]) => (
              <div key={key} className="rounded-lg border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{t(`mockSafety.stats.${key}`)}</dt>
                <dd className="text-xl font-semibold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          {!data.settings.enabled && (
            <p
              role="status"
              className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
            >
              {t('mockSafety.offNotice')}
            </p>
          )}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="flagged">{t('mockSafety.tabs.flagged')}</TabsTrigger>
              <TabsTrigger value="blocked">{t('mockSafety.tabs.blocked')}</TabsTrigger>
              <TabsTrigger value="settings">{t('mockSafety.tabs.settings')}</TabsTrigger>
            </TabsList>
            <TabsContent value="flagged" className="flex flex-col gap-4 pt-2">
              <FlaggedList items={data.items} />
              <Simulator />
            </TabsContent>
            <TabsContent value="blocked" className="pt-2">
              <BlockedList state={data} />
            </TabsContent>
            <TabsContent value="settings" className="pt-2">
              <SafetySettingsForm settings={data.settings} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function LevelBadge({ level }: { level: SafetyLevel }) {
  const { t } = useTranslation('admin');
  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0',
        level === 'high' && 'border-danger/50 text-danger',
        level === 'warning' && 'border-warning/50 text-warning',
      )}
    >
      {t(`mockSafety.level.${level}`)}
    </Badge>
  );
}

type HistoryAction = 'autoBlocked' | 'safe' | 'release' | 'delete' | 'report' | 'block' | 'unblock';

const time = (at: number, locale: string) =>
  new Date(at).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

function FlaggedList({ items }: { items: SafetyItem[] }) {
  const { t, i18n } = useTranslation('admin');
  const { t: ti } = useTranslation('inbox');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const labelId = useId();
  const shown = items.filter((i) => (filter === 'open' ? i.status === 'open' : true));
  const current = items.find((i) => i.id === selected) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <span id={labelId} className="sr-only">
        {t('mockSafety.filter.label')}
      </span>
      <SegmentedControl
        aria-labelledby={labelId}
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'open', label: t('mockSafety.filter.open') },
          { value: 'all', label: t('mockSafety.filter.all') },
        ]}
        className="self-start"
      />
      {shown.length === 0 ? (
        <p
          data-testid="safety-empty"
          className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
        >
          {t(filter === 'open' ? 'mockSafety.empty.open' : 'mockSafety.empty.all')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="safety-list">
          {shown.map((item) => (
            <li key={item.id}>
              <Button
                type="button"
                variant="ghost"
                data-testid="safety-row"
                data-scenario={item.scenario}
                onClick={() => setSelected(item.id)}
                className="flex h-auto w-full flex-col items-stretch gap-1.5 rounded-lg border px-3 py-3 text-left whitespace-normal hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <LevelBadge level={item.level} />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.senderName}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {time(item.at, i18n.language)}
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {item.phone} ·{' '}
                  {t(
                    item.existingCustomer ? 'mockSafety.sender.customer' : 'mockSafety.sender.new',
                  )}
                </span>
                <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                  {item.file ? (
                    <FileWarning className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <MessageSquareWarning className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 truncate">{item.file?.name ?? item.text}</span>
                </span>
                <span className="text-sm font-normal">
                  {item.status === 'cleared'
                    ? ti(`mockSafety.ai.${item.scenario}`)
                    : ti(`mockSafety.rule.${item.ruleCodes[0]!}`)}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{t(`mockSafety.status.${item.status}`)}</Badge>
                  {item.autoBlocked && (
                    <Badge variant="secondary">{t('mockSafety.chip.autoBlocked')}</Badge>
                  )}
                  {item.existingCustomer && item.level === 'high' && (
                    <Badge variant="secondary">{t('mockSafety.chip.maybeHacked')}</Badge>
                  )}
                  {item.quarantined && !item.released && !item.deleted && (
                    <Badge variant="secondary">
                      <Lock aria-hidden />
                      {t('mockSafety.chip.locked')}
                    </Badge>
                  )}
                  {item.downloads.length > 0 && (
                    <Badge variant="secondary">
                      {t('mockSafety.chip.downloadedBy', {
                        names: item.downloads.map((d) => d.name).join(', '),
                      })}
                    </Badge>
                  )}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ItemSheet item={current} onClose={() => setSelected(null)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function ItemSheet({ item, onClose }: { item: SafetyItem | null; onClose: () => void }) {
  const { t, i18n } = useTranslation('admin');
  const { t: ti } = useTranslation('inbox');
  const action = useSafetyAction();
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trust, setTrust] = useState(false);
  const trustId = useId();
  const run = (name: Parameters<typeof action.mutate>[0]['action'], body?: object) =>
    item &&
    action.mutate(
      { id: item.id, action: name, body: body as Record<string, unknown> | undefined },
      {
        onSuccess: () => toast.success(t(`mockSafety.done.${name}`)),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  return (
    <Sheet open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-md"
        data-testid="safety-sheet"
      >
        {item && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-2 pr-8">
                <LevelBadge level={item.level} />
                <Badge variant="secondary">{t(`mockSafety.status.${item.status}`)}</Badge>
              </div>
              <SheetTitle className="[overflow-wrap:anywhere]">{item.senderName}</SheetTitle>
              <SheetDescription>
                {item.phone} ·{' '}
                {t(item.existingCustomer ? 'mockSafety.sender.customer' : 'mockSafety.sender.new')}{' '}
                · {time(item.at, i18n.language)}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 py-4">
              {item.existingCustomer && item.level === 'high' && (
                <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
                  {t('mockSafety.sheet.hackedNote')}
                </p>
              )}
              <Section title={t('mockSafety.sheet.what')}>
                <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  {item.text}
                </p>
                {item.file && (
                  <div className="rounded-md border px-3 py-2 text-sm">
                    <p className="font-medium [overflow-wrap:anywhere]">{item.file.name}</p>
                    {item.file.inside.length > 0 && (
                      <p className="mt-1 text-xs [overflow-wrap:anywhere] text-muted-foreground">
                        {t('mockSafety.sheet.inside', { names: item.file.inside.join(', ') })}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.deleted
                        ? t('mockSafety.sheet.fileDeleted', { name: item.deleted.by })
                        : item.quarantined && !item.released
                          ? t('mockSafety.sheet.fileLocked')
                          : t('mockSafety.sheet.fileOpen')}
                    </p>
                  </div>
                )}
              </Section>
              <Section title={t('mockSafety.sheet.why')}>
                <ul className="flex flex-col gap-1 text-sm">
                  {item.ruleCodes.map((r) => (
                    <li key={r} className="flex gap-2">
                      <ShieldAlert
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      {ti(`mockSafety.rule.${r}`)}
                    </li>
                  ))}
                </ul>
                <p className="flex gap-2 text-sm">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {item.ai
                    ? t('mockSafety.sheet.ai', {
                        level: t(`mockSafety.level.${item.ai.level}`),
                        reason: ti(`mockSafety.ai.${item.ai.reason}`),
                      })
                    : t('mockSafety.sheet.aiOff')}
                </p>
              </Section>
              <Section title={t('mockSafety.sheet.team')}>
                {item.downloads.length === 0 &&
                item.history.filter((h) => h.action === 'downloadRefused').length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('mockSafety.sheet.noDownloads')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {item.downloads.map((d, i) => (
                      <li key={`d${i}`}>
                        {t('mockSafety.sheet.downloaded', {
                          name: d.name,
                          time: time(d.at, i18n.language),
                        })}
                      </li>
                    ))}
                    {item.history
                      .filter((h) => h.action === 'downloadRefused')
                      .map((h, i) => (
                        <li key={`r${i}`} className="text-muted-foreground">
                          {t('mockSafety.sheet.refused', {
                            name: h.by,
                            time: time(h.at, i18n.language),
                          })}
                        </li>
                      ))}
                  </ul>
                )}
              </Section>
              {item.history.some((h) => h.action !== 'downloadRefused') && (
                <Section title={t('mockSafety.sheet.history')}>
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {item.history
                      .filter((h) => h.action !== 'downloadRefused')
                      .map((h, i) => (
                        <li key={i}>
                          {t(`mockSafety.history.${h.action as HistoryAction}`, {
                            name: h.by,
                            time: time(h.at, i18n.language),
                          })}
                        </li>
                      ))}
                  </ul>
                </Section>
              )}
              <div className="flex flex-col gap-2 border-t pt-4" data-testid="safety-actions">
                {item.status !== 'safe' && item.status !== 'cleared' && (
                  <div className="flex flex-col gap-2 rounded-lg border px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={trustId}
                        checked={trust}
                        onCheckedChange={(v) => setTrust(v === true)}
                      />
                      <Label htmlFor={trustId} className="text-sm font-normal">
                        {t('mockSafety.actions.trust')}
                      </Label>
                    </div>
                    <Button
                      variant="outline"
                      size="touch"
                      disabled={action.isPending}
                      onClick={() => run('safe', { trust })}
                    >
                      {t('mockSafety.actions.safe')}
                    </Button>
                  </div>
                )}
                {!item.scam && (
                  <Button
                    variant="destructive"
                    size="touch"
                    data-testid="safety-report"
                    onClick={() => setReportOpen(true)}
                  >
                    {t('mockSafety.actions.report')}
                  </Button>
                )}
                {item.blocked ? (
                  <Button
                    variant="outline"
                    size="touch"
                    disabled={action.isPending}
                    onClick={() => run('unblock')}
                  >
                    {t('mockSafety.actions.unblock')}
                  </Button>
                ) : (
                  item.scam && (
                    <Button
                      variant="outline"
                      size="touch"
                      disabled={action.isPending}
                      onClick={() => run('block')}
                    >
                      <Ban aria-hidden />
                      {t('mockSafety.actions.block')}
                    </Button>
                  )
                )}
                {item.quarantined && !item.released && !item.deleted && (
                  <Button
                    variant="outline"
                    size="touch"
                    disabled={action.isPending}
                    onClick={() => run('release')}
                  >
                    {t('mockSafety.actions.release')}
                  </Button>
                )}
                {item.file && !item.deleted && (
                  <Button variant="ghost" size="touch" onClick={() => setConfirmDelete(true)}>
                    {t('mockSafety.actions.delete')}
                  </Button>
                )}
                <Button asChild variant="link" className="self-start px-0">
                  <Link to={`/chats/${encodeURIComponent(item.chatJid)}`}>
                    {t('mockSafety.actions.openChat')}
                  </Link>
                </Button>
              </div>
            </div>
            <ReportDialog
              item={item}
              open={reportOpen}
              onClose={() => setReportOpen(false)}
              onReport={(block) =>
                action.mutate(
                  { id: item.id, action: 'report', body: { block } },
                  {
                    onSuccess: () => {
                      setReportOpen(false);
                      toast.success(
                        t(block ? 'mockSafety.done.reportBlock' : 'mockSafety.done.report'),
                      );
                    },
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
              busy={action.isPending}
            />
            <ConfirmDialog
              open={confirmDelete}
              danger
              title={t('mockSafety.deleteTitle')}
              confirmLabel={t('mockSafety.actions.delete')}
              loading={action.isPending}
              onClose={() => setConfirmDelete(false)}
              onConfirm={() => {
                run('delete');
                setConfirmDelete(false);
              }}
            >
              {t('mockSafety.deleteBody')}
            </ConfirmDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Report: mark the number as a scam for the whole team, block it, and how to tell WhatsApp and the authorities. */
function ReportDialog({
  item,
  open,
  onClose,
  onReport,
  busy,
}: {
  item: SafetyItem;
  open: boolean;
  onClose: () => void;
  onReport: (block: boolean) => void;
  busy: boolean;
}) {
  const { t } = useTranslation('admin');
  const edition = useMockEdition();
  const blockId = useId();
  const [block, setBlock] = useState(true);
  // The mock's demo numbers are on the linked phone (inbox 1); a Business API inbox shows its own steps.
  const businessApi = false;
  return (
    <ConfirmDialog
      open={open}
      danger
      title={t('mockSafety.report.title', { name: item.senderName })}
      confirmLabel={t('mockSafety.report.confirm')}
      loading={busy}
      onClose={onClose}
      onConfirm={() => onReport(block)}
    >
      <div className="flex flex-col gap-3 text-left text-sm" data-testid="safety-report-dialog">
        <p>{t('mockSafety.report.scam')}</p>
        <div className="flex items-center gap-2">
          <Checkbox
            id={blockId}
            checked={block}
            disabled={item.blocked}
            onCheckedChange={(v) => setBlock(v === true)}
          />
          <Label htmlFor={blockId} className="font-normal">
            {t('mockSafety.report.block')}
          </Label>
        </div>
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="flex items-center gap-1 font-medium">
            {t('mockSafety.report.whatsappTitle')}
            <InfoTip topic="reportNumber" />
          </p>
          <p className="text-muted-foreground">
            {t(businessApi ? 'mockSafety.report.whatsappApi' : 'mockSafety.report.whatsappPhone')}
          </p>
        </div>
        <ul className="list-disc pl-5 text-muted-foreground">
          <li>{t('mockSafety.report.nsrc')}</li>
          <li>{t('mockSafety.report.cyber999')}</li>
        </ul>
        {edition === 'enterprise' && (
          <p className="text-xs text-muted-foreground">{t('mockSafety.report.allInboxes')}</p>
        )}
      </div>
    </ConfirmDialog>
  );
}

function BlockedList({ state }: { state: NonNullable<ReturnType<typeof useSafety>['data']> }) {
  const { t, i18n } = useTranslation('admin');
  const action = useSafetyAction();
  if (state.blocked.length === 0)
    return (
      <p
        data-testid="safety-blocked-empty"
        className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
      >
        {t('mockSafety.empty.blocked')}
      </p>
    );
  return (
    <ul className="flex flex-col gap-2" data-testid="safety-blocked">
      {state.blocked.map((b) => {
        const item = state.items.find((i) => i.chatJid === b.chatJid);
        return (
          <li
            key={b.chatJid}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-3"
          >
            <Ban className="size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{b.name}</p>
              <p className="text-sm text-muted-foreground">
                {b.phone} ·{' '}
                {b.auto
                  ? t('mockSafety.blockedBy.auto', { time: time(b.at, i18n.language) })
                  : t('mockSafety.blockedBy.admin', {
                      name: b.by,
                      time: time(b.at, i18n.language),
                    })}
              </p>
            </div>
            {item && (
              <Button
                variant="outline"
                size="touch"
                className="md:min-h-9"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(
                    { id: item.id, action: 'unblock' },
                    { onSuccess: () => toast.success(t('mockSafety.done.unblock')) },
                  )
                }
              >
                {t('mockSafety.actions.unblock')}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SettingRow({
  id,
  label,
  hint,
  tip,
  checked,
  disabled,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  hint: string;
  tip?: 'safetyAi' | 'autoBlock';
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
      <div className="min-w-0">
        <span className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          {tip && <InfoTip topic={tip} />}
        </span>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <Label htmlFor={id} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <Switch
          id={id}
          data-testid={testId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </Label>
    </div>
  );
}

function SafetySettingsForm({ settings }: { settings: SafetySettings }) {
  const { t } = useTranslation('admin');
  const save = useSafetySettings();
  const edition = useMockEdition();
  const ids = { on: useId(), ai: useId(), auto: useId(), days: useId() };
  const set = (body: Partial<SafetySettings>) =>
    save.mutate(body, {
      onSuccess: () => toast.success(t('mockSafety.settings.saved')),
      onError: (e) => toast.error(errorMessage(e)),
    });
  return (
    <Card className="gap-4" data-testid="safety-settings">
      <CardHeader>
        <CardTitle>{t('mockSafety.settings.title')}</CardTitle>
        <CardDescription>{t('mockSafety.settings.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <SettingRow
          id={ids.on}
          testId="safety-enabled"
          label={t('mockSafety.settings.enabled')}
          hint={t('mockSafety.settings.enabledHint')}
          checked={settings.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <SettingRow
          id={ids.ai}
          testId="safety-ai"
          tip="safetyAi"
          label={t('mockSafety.settings.ai')}
          hint={t('mockSafety.settings.aiHint')}
          checked={settings.ai}
          disabled={!settings.enabled}
          onChange={(ai) => set({ ai })}
        />
        <SettingRow
          id={ids.auto}
          testId="safety-auto-block"
          tip="autoBlock"
          label={t('mockSafety.settings.autoBlock')}
          hint={t('mockSafety.settings.autoBlockHint')}
          checked={settings.autoBlock}
          disabled={!settings.enabled}
          onChange={(autoBlock) => set({ autoBlock })}
        />
        <div className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5">
              <Label htmlFor={ids.days}>{t('mockSafety.settings.days')}</Label>
              <InfoTip topic="lockedFiles" />
            </span>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('mockSafety.settings.daysHint')}
            </p>
          </div>
          <Select
            value={String(settings.deleteAfterDays)}
            onValueChange={(v) => set({ deleteAfterDays: Number(v) as 7 | 30 | 90 })}
          >
            <SelectTrigger id={ids.days} className="min-h-11 w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {[7, 30, 90].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t('mockSafety.settings.daysOption', { days: d })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className={cn(
            'flex items-start justify-between gap-4 rounded-lg border px-3 py-3',
            edition === 'lite' && 'opacity-60',
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('mockSafety.settings.reputation')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('mockSafety.settings.reputationHint')}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {edition === 'lite' ? t('mockSafety.settings.enterprise') : t('mockSuggest.proposed')}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

/** Mock only: deliver one of the demo messages now, as if it just arrived on the linked phone. */
function Simulator() {
  const { t } = useTranslation('admin');
  const simulate = useSimulate();
  const { data } = useSafety();
  const seen = useRef<Set<string> | null>(null);
  // Stand-in for the push alert admins get on a High-risk message.
  useEffect(() => {
    if (!data) return;
    if (!seen.current) {
      seen.current = new Set(data.items.map((i) => i.id));
      return;
    }
    for (const item of data.items)
      if (!seen.current.has(item.id)) {
        seen.current.add(item.id);
        if (item.level === 'high')
          toast.warning(
            t(item.autoBlocked ? 'mockSafety.alert.autoBlocked' : 'mockSafety.alert.high', {
              name: item.senderName,
            }),
          );
      }
  }, [data, t]);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-3 text-sm"
      data-testid="safety-simulator"
    >
      <p className="font-medium text-muted-foreground">{t('mockSafety.sim.title')}</p>
      <div className="flex flex-wrap gap-2">
        {(data?.scenarios ?? []).map((s) => (
          <Button
            key={s}
            variant="outline"
            size="sm"
            data-testid={`simulate-${s}`}
            disabled={simulate.isPending}
            onClick={() => simulate.mutate(s, { onError: (e) => toast.error(errorMessage(e)) })}
          >
            {t(`mockSafety.sim.${s}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

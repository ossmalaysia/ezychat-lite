import { useId, useState } from 'react';
import { Ban, FileWarning, Lock, MessageSquareWarning, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type {
  SafetyAction,
  SafetyItemView,
  SafetyLevel,
  SafetySettings,
  SafetyState,
} from '@ezychat/shared';
import { errorMessage } from '../api/client';
import { useInboxes } from '../api/queries';
import { useSafety, useSafetyAction, useSafetySettings } from '../api/safety';
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
import { ConfirmDialog, ErrorState, ListSkeleton } from './adminUi';

/**
 * Admin → Safety (docs/features/whatsapp-safety/design.md): what WhatsApp Safety flagged (who sent
 * it, from which number, why, who on the team downloaded it), the blocked numbers and the settings.
 * Admins only, every inbox.
 */
export function SafetyPage() {
  const { t } = useTranslation('admin');
  const { data, error, refetch, isLoading } = useSafety();
  const [tab, setTab] = useState('flagged');
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const open = data?.items.filter((i) => i.status === 'open') ?? [];
  const locked =
    data?.items.filter((i) => i.quarantined && !i.released && !i.deleted && i.status !== 'safe') ??
    [];
  return (
    <div className="flex flex-col gap-4" data-testid="safety-page">
      <PageHeader
        className="pb-0"
        title={t('safety.title')}
        description={t('safety.description')}
      />
      {isLoading || !data ? (
        <ListSkeleton />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2" data-testid="safety-stats">
            <Stat label={t('safety.stats.toReview')} value={open.length} />
            <Stat label={t('safety.stats.filesLocked')} value={locked.length} />
            <Stat label={t('safety.stats.blocked')} value={data.blocked.length} />
          </dl>
          {!data.settings.enabled && (
            <p
              role="status"
              className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
            >
              {t('safety.offNotice')}
            </p>
          )}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="flagged">{t('safety.tabs.flagged')}</TabsTrigger>
              <TabsTrigger value="blocked">{t('safety.tabs.blocked')}</TabsTrigger>
              <TabsTrigger value="settings">{t('safety.tabs.settings')}</TabsTrigger>
            </TabsList>
            <TabsContent value="flagged" className="pt-2">
              <FlaggedList items={data.items} />
            </TabsContent>
            <TabsContent value="blocked" className="pt-2">
              <BlockedList state={data} />
            </TabsContent>
            <TabsContent value="settings" className="pt-2">
              <SafetySettingsForm settings={data.settings} aiReady={data.aiReady} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
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
      {t(`safety.level.${level}`)}
    </Badge>
  );
}

function useWhen() {
  const { i18n } = useTranslation();
  return (at: number) =>
    new Date(at).toLocaleString(i18n.resolvedLanguage ?? 'en', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
}

const plusPhone = (phone: string | null) => (phone ? `+${phone}` : null);

function FlaggedList({ items }: { items: SafetyItemView[] }) {
  const { t } = useTranslation('admin');
  const { t: ti } = useTranslation('inbox');
  const when = useWhen();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [selected, setSelected] = useState<number | null>(null);
  const labelId = useId();
  const shown = items.filter((i) => (filter === 'open' ? i.status === 'open' : true));
  const current = items.find((i) => i.id === selected) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <span id={labelId} className="sr-only">
        {t('safety.filter.label')}
      </span>
      <SegmentedControl
        aria-labelledby={labelId}
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'open', label: t('safety.filter.open') },
          { value: 'all', label: t('safety.filter.all') },
        ]}
        className="self-start"
      />
      {shown.length === 0 ? (
        <p
          data-testid="safety-empty"
          className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
        >
          {filter === 'open' ? t('safety.empty.open') : t('safety.empty.all')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="safety-list">
          {shown.map((item) => (
            <li key={item.id}>
              <Button
                type="button"
                variant="ghost"
                data-testid="safety-row"
                onClick={() => setSelected(item.id)}
                className="flex h-auto w-full flex-col items-stretch gap-1.5 rounded-lg border px-3 py-3 text-left whitespace-normal hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <LevelBadge level={item.level} />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.senderName}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {when(item.at)}
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {[
                    plusPhone(item.phone),
                    item.group
                      ? t('safety.sender.group')
                      : item.existingCustomer
                        ? t('safety.sender.customer')
                        : t('safety.sender.new'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                  {item.file ? (
                    <FileWarning className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <MessageSquareWarning className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 truncate">{item.file?.name ?? item.text ?? ''}</span>
                </span>
                <span className="text-sm font-normal">
                  {item.status === 'cleared' && item.ai?.reason
                    ? item.ai.reason
                    : item.rules[0]
                      ? ti(`safety.rule.${item.rules[0]}`)
                      : ''}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{t(`safety.status.${item.status}`)}</Badge>
                  {item.autoBlocked && (
                    <Badge variant="secondary">{t('safety.chip.autoBlocked')}</Badge>
                  )}
                  {item.existingCustomer && item.level === 'high' && !item.group && (
                    <Badge variant="secondary">{t('safety.chip.maybeHacked')}</Badge>
                  )}
                  {item.quarantined && !item.released && !item.deleted && (
                    <Badge variant="secondary">
                      <Lock aria-hidden />
                      {t('safety.chip.locked')}
                    </Badge>
                  )}
                  {item.downloads.some((d) => d.allowed) && (
                    <Badge variant="secondary">
                      {t('safety.chip.downloadedBy', {
                        names: [
                          ...new Set(item.downloads.filter((d) => d.allowed).map((d) => d.name)),
                        ].join(', '),
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

function ItemSheet({ item, onClose }: { item: SafetyItemView | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const { t: ti } = useTranslation('inbox');
  const when = useWhen();
  const action = useSafetyAction();
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trust, setTrust] = useState(false);
  const trustId = useId();
  const run = (name: SafetyAction, body: { trust?: boolean; block?: boolean } = {}) =>
    item &&
    action.mutate(
      { id: item.id, action: name, body },
      {
        onSuccess: () => {
          toast.success(t(`safety.done.${name}`));
          setReportOpen(false);
          setConfirmDelete(false);
        },
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
                <Badge variant="secondary">{t(`safety.status.${item.status}`)}</Badge>
              </div>
              <SheetTitle className="[overflow-wrap:anywhere]">{item.senderName}</SheetTitle>
              <SheetDescription>
                {[
                  plusPhone(item.phone),
                  item.group
                    ? t('safety.sender.group')
                    : item.existingCustomer
                      ? t('safety.sender.customer')
                      : t('safety.sender.new'),
                  when(item.at),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 py-4">
              {item.existingCustomer && item.level === 'high' && !item.group && (
                <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
                  {t('safety.sheet.hackedNote')}
                </p>
              )}
              <Section title={t('safety.sheet.what')}>
                {item.text && (
                  <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    {item.text}
                  </p>
                )}
                {item.file && (
                  <div className="rounded-md border px-3 py-2 text-sm">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {item.file.name ?? t('safety.sheet.file')}
                    </p>
                    {item.file.inside.length > 0 && (
                      <p className="mt-1 text-xs [overflow-wrap:anywhere] text-muted-foreground">
                        {t('safety.sheet.inside', { names: item.file.inside.join(', ') })}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.deleted
                        ? item.deleted.by
                          ? t('safety.sheet.fileDeletedBy', { name: item.deleted.by })
                          : t('safety.sheet.fileDeleted')
                        : item.quarantined && !item.released && item.status !== 'safe'
                          ? t('safety.sheet.fileLocked')
                          : t('safety.sheet.fileOpen')}
                    </p>
                  </div>
                )}
              </Section>
              <Section title={t('safety.sheet.why')}>
                <ul className="flex flex-col gap-1 text-sm">
                  {item.rules.map((r) => (
                    <li key={r} className="flex gap-2">
                      <ShieldAlert
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      {ti(`safety.rule.${r}`)}
                    </li>
                  ))}
                </ul>
                <p className="flex gap-2 text-sm">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="[overflow-wrap:anywhere]">
                    {item.ai
                      ? t('safety.sheet.ai', {
                          level: t(`safety.level.${item.ai.level}`),
                          reason: item.ai.reason,
                        })
                      : t('safety.sheet.aiNone')}
                  </span>
                </p>
              </Section>
              {item.file && (
                <Section title={t('safety.sheet.team')}>
                  {item.downloads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('safety.sheet.noDownloads')}</p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm" data-testid="safety-downloads">
                      {item.downloads.map((d, i) => (
                        <li key={i} className={cn(!d.allowed && 'text-muted-foreground')}>
                          {d.allowed
                            ? t('safety.sheet.downloaded', { name: d.name, time: when(d.at) })
                            : t('safety.sheet.refused', { name: d.name, time: when(d.at) })}
                        </li>
                      ))}
                    </ul>
                  )}
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
                        {t('safety.actions.trust')}
                      </Label>
                    </div>
                    <Button
                      variant="outline"
                      size="touch"
                      disabled={action.isPending}
                      onClick={() => run('safe', { trust })}
                    >
                      {t('safety.actions.safe')}
                    </Button>
                  </div>
                )}
                {!item.scam && !item.group && (
                  <Button
                    variant="destructive"
                    size="touch"
                    data-testid="safety-report"
                    onClick={() => setReportOpen(true)}
                  >
                    {t('safety.actions.report')}
                  </Button>
                )}
                {item.blocked ? (
                  <Button
                    variant="outline"
                    size="touch"
                    disabled={action.isPending}
                    onClick={() => run('unblock')}
                  >
                    {t('safety.actions.unblock')}
                  </Button>
                ) : (
                  item.scam &&
                  item.canBlock && (
                    <Button
                      variant="outline"
                      size="touch"
                      disabled={action.isPending}
                      onClick={() => run('block')}
                    >
                      <Ban aria-hidden />
                      {t('safety.actions.block')}
                    </Button>
                  )
                )}
                {item.quarantined && !item.released && !item.deleted && item.status !== 'safe' && (
                  <Button
                    variant="outline"
                    size="touch"
                    disabled={action.isPending}
                    onClick={() => run('release')}
                  >
                    {t('safety.actions.release')}
                  </Button>
                )}
                {item.file && !item.deleted && (
                  <Button variant="ghost" size="touch" onClick={() => setConfirmDelete(true)}>
                    {t('safety.actions.delete')}
                  </Button>
                )}
                <Button asChild variant="link" className="self-start px-0">
                  <Link to={`/chats/${encodeURIComponent(item.chatJid)}`}>
                    {t('safety.actions.openChat')}
                  </Link>
                </Button>
              </div>
            </div>
            <ReportDialog
              item={item}
              open={reportOpen}
              onClose={() => setReportOpen(false)}
              onReport={(block) => run('report', { block })}
              busy={action.isPending}
            />
            <ConfirmDialog
              open={confirmDelete}
              danger
              title={t('safety.deleteTitle')}
              confirmLabel={t('safety.actions.delete')}
              loading={action.isPending}
              onClose={() => setConfirmDelete(false)}
              onConfirm={() => run('delete')}
            >
              {t('safety.deleteBody')}
            </ConfirmDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Report: a scam warning for the whole team, block where the connection allows, and who else to tell. */
function ReportDialog({
  item,
  open,
  onClose,
  onReport,
  busy,
}: {
  item: SafetyItemView;
  open: boolean;
  onClose: () => void;
  onReport: (block: boolean) => void;
  busy: boolean;
}) {
  const { t } = useTranslation('admin');
  const { data: inboxes } = useInboxes();
  const blockId = useId();
  const [block, setBlock] = useState(true);
  const inbox = inboxes?.inboxes.find((i) => i.id === item.inboxId);
  // A number linked by QR has the WhatsApp app on a phone; a Business API number has none.
  const phoneApp = inbox ? inbox.capabilities.qrLink : true;
  return (
    <ConfirmDialog
      open={open}
      danger
      title={t('safety.report.title', { name: item.senderName })}
      confirmLabel={t('safety.report.confirm')}
      loading={busy}
      onClose={onClose}
      onConfirm={() => onReport(block && item.canBlock)}
    >
      <div className="flex flex-col gap-3 text-left text-sm" data-testid="safety-report-dialog">
        <p>{t('safety.report.scam')}</p>
        <div className="flex items-center gap-2">
          <Checkbox
            id={blockId}
            checked={block && item.canBlock}
            disabled={!item.canBlock}
            onCheckedChange={(v) => setBlock(v === true)}
          />
          <Label htmlFor={blockId} className="font-normal">
            {item.canBlock ? t('safety.report.block') : t('safety.report.cannotBlock')}
          </Label>
        </div>
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="flex items-center gap-1 font-medium">
            {t('safety.report.whatsappTitle')}
            {phoneApp && <InfoTip topic="reportNumber" />}
          </p>
          <p className="text-muted-foreground">
            {phoneApp ? t('safety.report.whatsappPhone') : t('safety.report.whatsappApi')}
          </p>
        </div>
        <ul className="list-disc pl-5 text-muted-foreground">
          <li>{t('safety.report.nsrc')}</li>
          <li>{t('safety.report.cyber999')}</li>
        </ul>
      </div>
    </ConfirmDialog>
  );
}

function BlockedList({ state }: { state: SafetyState }) {
  const { t } = useTranslation('admin');
  const when = useWhen();
  const action = useSafetyAction();
  if (state.blocked.length === 0)
    return (
      <p
        data-testid="safety-blocked-empty"
        className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
      >
        {t('safety.empty.blocked')}
      </p>
    );
  return (
    <ul className="flex flex-col gap-2" data-testid="safety-blocked">
      {state.blocked.map((b) => (
        <li
          key={b.waJid}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-3"
        >
          <Ban className="size-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{b.name}</p>
            <p className="text-sm text-muted-foreground">
              {[
                plusPhone(b.phone),
                b.auto
                  ? t('safety.blockedBy.auto', { time: when(b.at) })
                  : b.by
                    ? t('safety.blockedBy.admin', { name: b.by, time: when(b.at) })
                    : t('safety.blockedBy.unknown', { time: when(b.at) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {b.itemId !== null && (
            <Button
              variant="outline"
              size="touch"
              className="md:min-h-9"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(
                  { id: b.itemId!, action: 'unblock' },
                  {
                    onSuccess: () => toast.success(t('safety.done.unblock')),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
            >
              {t('safety.actions.unblock')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function SettingRow({
  label,
  hint,
  tip,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  hint: string;
  tip?: 'safetyAi' | 'autoBlock';
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  const id = useId();
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

function SafetySettingsForm({ settings, aiReady }: { settings: SafetySettings; aiReady: boolean }) {
  const { t } = useTranslation('admin');
  const save = useSafetySettings();
  const daysId = useId();
  const set = (body: Partial<SafetySettings>) =>
    save.mutate(body, {
      onSuccess: () => toast.success(t('safety.settings.saved')),
      onError: (e) => toast.error(errorMessage(e)),
    });
  return (
    <Card className="gap-4" data-testid="safety-settings">
      <CardHeader>
        <CardTitle>{t('safety.settings.title')}</CardTitle>
        <CardDescription>{t('safety.settings.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <SettingRow
          testId="safety-enabled"
          label={t('safety.settings.enabled')}
          hint={t('safety.settings.enabledHint')}
          checked={settings.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <SettingRow
          testId="safety-ai"
          tip="safetyAi"
          label={t('safety.settings.ai')}
          hint={aiReady ? t('safety.settings.aiHint') : t('safety.settings.aiNotConnected')}
          checked={settings.ai}
          disabled={!settings.enabled}
          onChange={(ai) => set({ ai })}
        />
        <SettingRow
          testId="safety-auto-block"
          tip="autoBlock"
          label={t('safety.settings.autoBlock')}
          hint={t('safety.settings.autoBlockHint')}
          checked={settings.autoBlock}
          disabled={!settings.enabled}
          onChange={(autoBlock) => set({ autoBlock })}
        />
        <div className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5">
              <Label htmlFor={daysId}>{t('safety.settings.days')}</Label>
              <InfoTip topic="lockedFiles" />
            </span>
            <p className="mt-1 text-sm text-muted-foreground">{t('safety.settings.daysHint')}</p>
          </div>
          <Select
            value={String(settings.deleteAfterDays)}
            onValueChange={(v) => set({ deleteAfterDays: Number(v) as 7 | 30 | 90 })}
          >
            <SelectTrigger id={daysId} className="min-h-11 w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {([7, 30, 90] as const).map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t('safety.settings.daysOption', { days: d })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

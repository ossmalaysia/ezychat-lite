import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { toast } from 'sonner';
import type { DreamChange, DreamChangeStatus, DreamRun } from '@ezychat/shared';
import { ApiError } from '../api/client';
import { useDream, useDreamAction, useSaveDream, type DreamAction } from '../api/dream';
import { Badge } from '@/components/ui/badge';
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
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ErrorState, ListSkeleton } from './adminUi';
import { DreamChangeDialog } from './DreamChangeDialog';

/** Every half hour of the day. */
const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
);

const STATUS_TONE: Record<DreamChangeStatus, string> = {
  waiting: 'border-transparent bg-warning/15 text-warning',
  applied: 'border-transparent bg-success/15 text-success',
  dismissed: 'border-transparent bg-muted text-muted-foreground',
  undone: 'border-transparent bg-muted text-muted-foreground',
  stale: 'border-transparent bg-muted text-muted-foreground',
  expired: 'border-transparent bg-muted text-muted-foreground',
};

/**
 * Agent page → Dream mode (design docs/superpowers/specs/2026-11-14-dream-mode-design.md, confirmed quick mock
 * docs/features/dream-mode/mock): the switch, the nightly time, Apply by itself, and the history of nights with each
 * change's state and actions. Settings save at once, like the other agent switches.
 */
export function AgentDreamCard({ agentId, name }: Readonly<{ agentId: number; name: string }>) {
  const { t, i18n } = useTranslation('admin');
  const ids = { dream: useId(), time: useId(), auto: useId() };
  const q = useDream(agentId);
  const save = useSaveDream(agentId);
  const act = useDreamAction(agentId);
  const [open, setOpen] = useState<DreamChange | null>(null);
  const when = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [i18n.language],
  );

  const saveSetting = (body: Parameters<typeof save.mutate>[0]) =>
    save.mutate(body, { onError: () => toast.error(t('ai.dream.saveFailed')) });
  const run = (change: DreamChange, action: DreamAction) =>
    act.mutate(
      { id: change.id, action },
      {
        onSuccess: () => setOpen(null),
        onError: (error) =>
          toast.error(
            error instanceof ApiError && error.code === 'setup_changed'
              ? t('ai.dream.outdated')
              : t('ai.dream.actionFailed'),
          ),
      },
    );

  const data = q.data;
  const settings = data?.settings;
  const times =
    settings && !TIMES.includes(settings.runTime) ? [...TIMES, settings.runTime].sort() : TIMES;

  const runLine = (r: DreamRun) => {
    if (r.status === 'running') return t('ai.dream.run.running');
    if (r.status === 'skipped' && r.reason) return t(`ai.dream.run.${r.reason}`);
    if (r.status === 'missed' || r.status === 'failed') return t(`ai.dream.run.${r.status}`);
    const stats = t('ai.dream.runStats', {
      chats: r.chatsRead,
      takeovers: r.takeovers,
      changes: r.saved,
    });
    return r.saved || r.takeovers ? stats : `${stats} · ${t('ai.dream.run.nothing')}`;
  };

  return (
    <Card className="gap-4" data-testid="agent-dream">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Moon className="size-4" aria-hidden />
          {t('ai.dream.title')}
        </CardTitle>
        <CardDescription>{t('ai.dream.description', { name })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !data || !settings ? (
          <ListSkeleton rows={2} />
        ) : (
          <>
            {settings.enabled && !data.aiReady && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm" role="status">
                {t('ai.dream.paused')}
              </p>
            )}
            <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
              <div className="min-w-0">
                <Label htmlFor={ids.dream}>{t('ai.dream.switch')}</Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {settings.enabled ? t('ai.dream.on') : t('ai.dream.off')}
                </p>
              </div>
              <Label
                htmlFor={ids.dream}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
              >
                <Switch
                  id={ids.dream}
                  aria-label={t('ai.dream.switch')}
                  checked={settings.enabled}
                  disabled={save.isPending}
                  onCheckedChange={(enabled) => saveSetting({ enabled })}
                />
              </Label>
            </div>
            {settings.enabled && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3">
                  <div className="min-w-0">
                    <Label htmlFor={ids.time}>{t('ai.dream.runAt')}</Label>
                    <p className="mt-1 text-sm text-muted-foreground">{t('ai.dream.runAtHint')}</p>
                  </div>
                  <Select
                    value={settings.runTime}
                    onValueChange={(runTime) => saveSetting({ runTime })}
                  >
                    <SelectTrigger id={ids.time} className="min-h-11 w-28 md:min-h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {times.map((time) => (
                        <SelectItem key={time} value={time}>
                          {time}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
                  <div className="min-w-0">
                    <Label htmlFor={ids.auto}>{t('ai.dream.autoApply')}</Label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {settings.autoApply ? t('ai.dream.autoApplyOn') : t('ai.dream.autoApplyOff')}
                    </p>
                  </div>
                  <Label
                    htmlFor={ids.auto}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
                  >
                    <Switch
                      id={ids.auto}
                      aria-label={t('ai.dream.autoApply')}
                      checked={settings.autoApply}
                      disabled={save.isPending}
                      onCheckedChange={(autoApply) => saveSetting({ autoApply })}
                    />
                  </Label>
                </div>
              </>
            )}
            {(settings.enabled || data.runs.length > 0) && (
              <section className="flex flex-col gap-3" aria-labelledby={`${ids.dream}-history`}>
                <h3 id={`${ids.dream}-history`} className="text-sm font-medium">
                  {t('ai.dream.history')}
                </h3>
                {data.runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('ai.dream.historyEmpty', { time: settings.runTime })}
                  </p>
                ) : (
                  <ol className="flex flex-col divide-y">
                    {data.runs.map((r) => (
                      <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0">
                        <p className="text-sm">
                          <span className="font-medium">{when.format(r.slot)}</span>{' '}
                          <span className="text-muted-foreground">{runLine(r)}</span>
                          {r.dropped > 0 && (
                            <span className="text-muted-foreground">
                              {' '}
                              · {t('ai.dream.dropped', { count: r.dropped })}
                            </span>
                          )}
                        </p>
                        {r.changes.map((c) => (
                          <div
                            key={c.id}
                            data-testid="dream-change"
                            className="flex flex-col gap-1 rounded-lg border px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <Badge variant="outline" className={cn(STATUS_TONE[c.status])}>
                                {t(`ai.dream.status.${c.status}`)}
                              </Badge>
                              <span className="text-muted-foreground">
                                {[t(`ai.dream.target.${c.target}`), c.itemName]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </div>
                            <p className="font-medium break-words">{c.summary}</p>
                            <p className="text-xs text-muted-foreground">
                              {[
                                c.auto ? t('ai.dream.appliedByItself') : null,
                                t('ai.dream.sources', { count: c.sourceCount }),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {c.status === 'waiting' && (
                                <Button
                                  size="sm"
                                  disabled={act.isPending}
                                  onClick={() => run(c, 'apply')}
                                >
                                  {t('ai.dream.apply')}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setOpen(c)}>
                                {t('ai.dream.seeChange')}
                              </Button>
                              {c.status === 'waiting' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={act.isPending}
                                  onClick={() => run(c, 'dismiss')}
                                >
                                  {t('ai.dream.dismiss')}
                                </Button>
                              )}
                              {c.status === 'applied' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={act.isPending}
                                  onClick={() => run(c, 'undo')}
                                >
                                  {t('ai.dream.undo')}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </>
        )}
      </CardContent>
      {open && (
        <DreamChangeDialog
          agentId={agentId}
          change={open}
          when={when.format(open.createdAt)}
          busy={act.isPending}
          onAction={(action) => run(open, action)}
          onClose={() => setOpen(null)}
        />
      )}
    </Card>
  );
}

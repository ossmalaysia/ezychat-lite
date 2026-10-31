import type React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useSafetyReport, type SafetyReport, type SafetyReportTotals } from '../mock/safety';
import { ChartCard, NumberTable, RankedBars, useFormat } from './ReportCharts';

/**
 * Proposed (whatsapp-safety): Admin → Reports → WhatsApp Safety. What reached the team (dangerous
 * files, scam messages), what the team did with it (risky downloads, blocks) and whether the checks
 * are tuned right (false alarms), for the same 7 / 30 / 90 days as the rest of the page.
 */
export function SafetyReportSection({ days }: { days: 7 | 30 | 90 }) {
  const { t } = useTranslation('admin');
  const { data } = useSafetyReport(days);
  if (!data) return null;
  return (
    <section
      aria-labelledby="report-safety"
      className="flex min-w-0 flex-col gap-4"
      data-testid="report-safety"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h2 id="report-safety" className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
          {t('mockSafetyReport.title')}
          <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
        </h2>
        <Button asChild variant="outline" size="sm" className="pointer-coarse:min-h-11">
          <Link to="/admin/safety">{t('mockSafetyReport.open')}</Link>
        </Button>
      </div>
      {!data.enabled ? (
        <Card className="px-4 py-4 text-sm text-muted-foreground">{t('mockSafetyReport.off')}</Card>
      ) : (
        <SafetyBody report={data} />
      )}
    </section>
  );
}

function SafetyBody({ report }: { report: SafetyReport }) {
  const { t } = useTranslation('admin');
  const f = useFormat();
  const { totals: now, previous, days } = report;
  const delta = (key: keyof SafetyReportTotals) => {
    const before = previous?.[key];
    if (!before) return undefined;
    const pct = Math.round(((now[key] - before) / before) * 100);
    return pct === 0
      ? undefined
      : t('mockSafetyReport.vs', { pct: Math.abs(pct), sign: pct > 0 ? '+' : '−', count: days });
  };
  const falsePct = now.flagged ? Math.round((now.falseAlarms / now.flagged) * 100) : 0;
  const peak = report.daily.reduce((a, b) => (b.high + b.warning > a.high + a.warning ? b : a));
  return (
    <>
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3" data-testid="safety-totals">
        <Tile
          label={t('mockSafetyReport.dangerousFiles')}
          value={now.dangerousFiles}
          hint={delta('dangerousFiles') ?? t('mockSafetyReport.dangerousFilesHint')}
        />
        <Tile
          label={t('mockSafetyReport.scamMessages')}
          value={now.scamMessages}
          hint={delta('scamMessages') ?? t('mockSafetyReport.scamMessagesHint')}
        />
        <Tile
          label={t('mockSafetyReport.riskyDownloads')}
          value={now.riskyDownloads}
          hint={t('mockSafetyReport.riskyDownloadsHint', { count: now.refusedDownloads })}
          tone={now.riskyDownloads > 0 ? 'danger' : undefined}
          testId="safety-risky-downloads"
        />
        <Tile
          label={t('mockSafetyReport.numbersBlocked')}
          value={now.numbersBlocked}
          hint={t('mockSafetyReport.numbersBlockedHint', { count: now.autoBlocked })}
        />
        <Tile
          label={t('mockSafetyReport.maybeHacked')}
          value={now.maybeHacked}
          hint={t('mockSafetyReport.maybeHackedHint')}
          tone={now.maybeHacked > 0 ? 'warning' : undefined}
        />
        <Tile
          label={t('mockSafetyReport.falseAlarms')}
          value={`${falsePct}%`}
          hint={t('mockSafetyReport.falseAlarmsHint', {
            count: now.falseAlarms,
            total: now.flagged,
          })}
        />
      </div>
      <ChartCard
        testId="card-safety-daily"
        title={t('mockSafetyReport.dailyTitle')}
        finding={
          peak.high + peak.warning > 0
            ? t('mockSafetyReport.dailyFinding', {
                date: f.day(peak.date),
                count: peak.high + peak.warning,
              })
            : t('mockSafetyReport.dailyNone')
        }
        table={
          <NumberTable
            head={[
              t('mockReports.colDate'),
              t('mockSafety.level.high'),
              t('mockSafety.level.warning'),
            ]}
            rows={[...report.daily].reverse().map((d) => [f.day(d.date, true), d.high, d.warning])}
          />
        }
      >
        <StackedDays daily={report.daily} />
      </ChartCard>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ChartCard
          testId="card-safety-kinds"
          title={t('mockSafetyReport.kindsTitle')}
          finding={
            report.kinds[0]
              ? t('mockSafetyReport.kindsFinding', {
                  kind: t(`mockSafetyReport.kind.${report.kinds[0].kind}`),
                })
              : undefined
          }
        >
          <RankedBars
            rows={report.kinds.map((k) => ({
              key: k.kind,
              label: t(`mockSafetyReport.kind.${k.kind}`),
              count: k.count,
            }))}
          />
        </ChartCard>
        <ChartCard
          testId="card-safety-team"
          title={t('mockSafetyReport.teamTitle')}
          finding={t('mockSafetyReport.teamFinding')}
        >
          <NumberTable
            head={[
              t('mockSafetyReport.colTeammate'),
              t('mockSafetyReport.colRisky'),
              t('mockSafetyReport.colRefused'),
            ]}
            rows={report.team.map((m) => [m.name, m.riskyDownloads, m.refused])}
          />
        </ChartCard>
      </div>
      <ChartCard
        testId="card-safety-senders"
        title={t('mockSafetyReport.sendersTitle')}
        finding={t('mockSafetyReport.sendersFinding')}
      >
        <NumberTable
          head={[
            t('mockSafetyReport.colSender'),
            t('mockSafetyReport.colFlagged'),
            t('mockSafetyReport.colStatus'),
          ]}
          rows={report.senders.map((s) => [
            <span key="s" className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{s.name}</span>
              <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {s.phone}
              </span>
            </span>,
            s.count,
            t(`mockSafetyReport.senderStatus.${s.status}`),
          ])}
        />
      </ChartCard>
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'warning' | 'danger';
  testId?: string;
}) {
  return (
    <Card
      className={cn(
        'min-w-0 gap-1 px-4 py-3',
        tone === 'warning' && 'border-warning/50',
        tone === 'danger' && 'border-danger/60 bg-danger/5',
      )}
      data-testid={testId}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** One stacked bar per day: High (danger) on top of Check (warning). */
function StackedDays({ daily }: { daily: SafetyReport['daily'] }) {
  const { t } = useTranslation('admin');
  const f = useFormat();
  const max = Math.max(1, ...daily.map((d) => d.high + d.warning));
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-32 items-end gap-px"
        role="img"
        aria-label={t('mockSafetyReport.dailyTitle')}
      >
        {daily.map((d) => (
          <div
            key={d.date}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${f.day(d.date, true)}: ${d.high} · ${d.warning}`}
          >
            <div className="bg-danger/80" style={{ height: `${(d.high / max) * 100}%` }} />
            <div className="bg-warning/70" style={{ height: `${(d.warning / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{f.day(daily[0]!.date)}</span>
        <span>{f.day(daily.at(-1)!.date)}</span>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-danger/80" aria-hidden />
          {t('mockSafety.level.high')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-warning/70" aria-hidden />
          {t('mockSafety.level.warning')}
        </span>
      </div>
    </div>
  );
}

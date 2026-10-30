import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  MessageSquare,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/app';
import { cn } from '@/lib/utils';
import { RankedBars } from '../admin/ReportCharts';
import { encodeJid } from '../lib/jid';
import type { AskBlock, AskTest } from '../mock/ask-ezy';

/** Where the change card stands; kept by the panel so "Apply both" updates every card. */
export interface ChangeState {
  status: 'proposed' | 'applied' | 'discarded';
  version?: number;
  busy?: boolean;
  error?: string | null;
}

export interface BlockContext {
  /** The chat the panel is scoped to (its summary shows "Back to chat" instead of "Open chat"). */
  scopeJid: string | null;
  /** Close the panel after following a link on a phone, so the chat is visible. */
  onNavigate: () => void;
  changes: Record<string, ChangeState>;
  onChange: (id: string, action: 'apply' | 'discard' | 'undo') => void;
  /** Sends the question of this answer again (after an Apply conflict). */
  onAskAgain: () => void;
  /** Wide screen: tests in change cards start open (on a phone they start folded). */
  wide: boolean;
}

/** The frame every block shares: a quiet card inside Ezy's answer. */
function Frame({
  title,
  finding,
  children,
  testId,
  changeId,
}: {
  title?: string;
  finding?: string;
  children: React.ReactNode;
  testId: string;
  changeId?: string;
}) {
  return (
    <section
      className="flex min-w-0 scroll-mt-2 flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid={testId}
      data-change-id={changeId}
    >
      {title && (
        <header className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          {finding && <p className="text-sm text-muted-foreground">{finding}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

function StatsBlock({ block }: { block: Extract<AskBlock, { type: 'stats' }> }) {
  const { t } = useTranslation('inbox');
  return (
    <Frame testId="ask-block-stats">
      <dl className="grid grid-cols-2 gap-2">
        {block.items.map((item) => (
          <div
            key={item.label}
            className="flex min-w-0 flex-col gap-0.5 rounded-md bg-muted/50 p-2"
          >
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
            {item.change && (
              <dd
                className={cn(
                  'flex items-center gap-0.5 text-xs',
                  item.good ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {item.change.startsWith('−') || item.change.startsWith('-') ? (
                  <ArrowDownRight className="size-3 shrink-0" aria-hidden />
                ) : (
                  <ArrowUpRight className="size-3 shrink-0" aria-hidden />
                )}
                <span>
                  {item.change}
                  {item.good !== undefined && (
                    <span>
                      {' '}
                      ({item.good ? t('askEzy.blocks.better') : t('askEzy.blocks.worse')})
                    </span>
                  )}
                </span>
              </dd>
            )}
            {item.note && <dd className="text-xs text-muted-foreground">{item.note}</dd>}
          </div>
        ))}
      </dl>
    </Frame>
  );
}

/**
 * Busy hours: the three busiest times as text (every screen, screen readers too), and on wider screens a
 * small grid for the eye (hidden from screen readers: the list carries the same facts).
 */
function HeatmapBlock({ block }: { block: Extract<AskBlock, { type: 'heatmap' }> }) {
  const { t, i18n } = useTranslation('inbox');
  const weekday = (wd: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + wd)),
    );
  const hour = (h: number) =>
    new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1, h)),
    );
  const cells = block.hours.flatMap((row, wd) => row.map((v, h) => ({ wd, h, v })));
  const top = [...cells].sort((a, b) => b.v - a.v).slice(0, 3);
  const max = Math.max(1, ...cells.map((c) => c.v));
  return (
    <Frame title={block.title} finding={block.finding} testId="ask-block-heatmap">
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-medium text-muted-foreground">{t('askEzy.blocks.busiest')}</h4>
        <ol className="flex flex-col gap-1 text-sm">
          {top.map((c, i) => (
            <li key={`${c.wd}-${c.h}`} className="flex items-baseline justify-between gap-2">
              <span>
                {i + 1}. {weekday(c.wd)} {hour(c.h)}–{hour((c.h + 1) % 24)}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {t('askEzy.blocks.conversations', { count: c.v })}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="hidden flex-col gap-1 sm:flex" aria-hidden>
        <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-0.5">
          {block.hours.map((row, wd) => (
            <div key={wd} className="contents">
              <span className="pr-1 text-xs leading-4 text-muted-foreground">
                {weekday(wd).slice(0, 3)}
              </span>
              {row.map((v, h) => (
                <span
                  key={h}
                  className="h-4 rounded-[3px] bg-primary"
                  style={{ opacity: v === 0 ? 0.06 : 0.15 + (v / max) * 0.85 }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-0.5">
          <span className="pr-1 text-xs text-transparent">{weekday(0).slice(0, 3)}</span>
          {[0, 6, 12, 18].map((h) => (
            <span
              key={h}
              className="col-span-6 text-xs leading-4 whitespace-nowrap text-muted-foreground"
            >
              {hour(h)}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('askEzy.blocks.heatmapLegend')}</p>
      </div>
    </Frame>
  );
}

function ChatsBlock({
  block,
  ctx,
}: {
  block: Extract<AskBlock, { type: 'chats' }>;
  ctx: BlockContext;
}) {
  const { t } = useTranslation('inbox');
  return (
    <Frame title={block.title} testId="ask-block-chats">
      <ul className="-mx-1 flex flex-col">
        {block.chats.map((c) => (
          <li key={c.jid}>
            <Link
              to={`/chats/${encodeJid(c.jid)}`}
              onClick={ctx.onNavigate}
              className="flex min-h-11 items-start gap-2 rounded-md px-1 py-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" aria-hidden />
                    {t('askEzy.blocks.waiting', { wait: c.wait })}
                  </span>
                </span>
                <span className="truncate text-sm text-muted-foreground">{c.preview}</span>
                <span className="text-xs text-muted-foreground">
                  {c.assignee
                    ? t('askEzy.blocks.assignee', { name: c.assignee })
                    : t('askEzy.blocks.unassigned')}
                </span>
              </span>
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 self-center text-muted-foreground"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function CustomerBlock({
  block,
  ctx,
}: {
  block: Extract<AskBlock, { type: 'customer' }>;
  ctx: BlockContext;
}) {
  const { t } = useTranslation('inbox');
  const here = ctx.scopeJid === block.jid;
  return (
    <Frame testId="ask-block-customer">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-sm font-semibold">{block.name}</h3>
          <ul className="flex flex-wrap gap-1">
            {block.facts.map((f) => (
              <li key={f}>
                <Badge variant="secondary" className="font-normal">
                  {f}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        {here && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 pointer-coarse:min-h-11 xl:hidden"
            onClick={ctx.onNavigate}
          >
            {t('askEzy.blocks.backToChat')}
          </Button>
        )}
        {!here && (
          <Button asChild variant="outline" size="sm" className="shrink-0 pointer-coarse:min-h-11">
            <Link to={`/chats/${encodeJid(block.jid)}`} onClick={ctx.onNavigate}>
              {t('askEzy.blocks.openChat')}
            </Link>
          </Button>
        )}
      </header>
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-medium text-muted-foreground">
          {t('askEzy.blocks.keyPoints')}
        </h4>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {block.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      {block.open.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t('askEzy.blocks.openQuestions')}
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {block.open.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="rounded-md bg-primary/10 px-2 py-1.5 text-sm">
        <span className="font-medium">{t('askEzy.blocks.nextStep')}</span> {block.next}
      </p>
    </Frame>
  );
}

/** Old and new text, line by line, with a visible word for added and removed lines (not colour only). */
function TextChange({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation('inbox');
  const old = before.split('\n');
  const now = after.split('\n');
  const removed = old.filter((l) => !now.includes(l));
  const kept = now.filter((l) => old.includes(l));
  const added = now.filter((l) => !old.includes(l));
  const Row = ({ kind, text }: { kind: 'added' | 'removed'; text: string }) => (
    <li className="flex items-start gap-2">
      <Badge
        variant="outline"
        className={cn(
          'mt-0.5 shrink-0 font-normal',
          kind === 'added' ? 'border-success/40 text-success' : 'text-muted-foreground',
        )}
      >
        {kind === 'added' ? `+ ${t('askEzy.blocks.added')}` : `− ${t('askEzy.blocks.removed')}`}
      </Badge>
      <span
        className={cn(
          'min-w-0',
          kind === 'added' ? 'font-medium' : 'text-muted-foreground line-through',
        )}
      >
        {text}
      </span>
    </li>
  );
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-2 text-sm">
      <ul className="flex flex-col gap-1.5">
        {removed.map((l) => (
          <Row key={`-${l}`} kind="removed" text={l} />
        ))}
        {added.map((l) => (
          <Row key={`+${l}`} kind="added" text={l} />
        ))}
      </ul>
      {kept.length > 0 && (
        <details className="group text-sm text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 transition-transform group-open:rotate-90"
              aria-hidden
            />
            {t('askEzy.blocks.unchanged', { count: kept.length })}
          </summary>
          <ul className="mt-1 flex flex-col gap-1 pl-2">
            {kept.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TestResult({ test, compact }: { test: AskTest; compact?: boolean }) {
  const { t } = useTranslation('inbox');
  return (
    <div className="flex flex-col gap-2" data-testid="ask-test-result">
      {!compact && <p className="text-xs text-muted-foreground">{t('askEzy.test.question')}</p>}
      <p className="self-start rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm">
        {test.question}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('askEzy.test.now')}</span>
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {test.before}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-primary">{t('askEzy.test.after')}</span>
          <p className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            {test.after}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChangeBlock({
  block,
  ctx,
}: {
  block: Extract<AskBlock, { type: 'change' }>;
  ctx: BlockContext;
}) {
  const { t } = useTranslation('inbox');
  const state = ctx.changes[block.id] ?? { status: block.status, version: block.version };
  const { status, busy, error } = state;
  // Apply, Discard and Undo replace the button that had focus: keep focus on this card, not the page top.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownStatus = useRef(status);
  useEffect(() => {
    if (shownStatus.current === status) return;
    shownStatus.current = status;
    titleRef.current?.focus();
  }, [status]);
  return (
    <Frame testId={`ask-block-change-${block.id}`} changeId={block.id}>
      <header className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 ref={titleRef} tabIndex={-1} className="text-sm font-semibold outline-none">
            {block.title}
          </h3>
          <Badge variant={status === 'applied' ? 'default' : 'secondary'}>
            {t(`askEzy.change.status.${status}`)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {[block.summary, block.target, block.agent].join(' · ')}
        </p>
      </header>
      <p className="text-sm">{block.reason}</p>
      <TextChange before={block.before} after={block.after} />
      {block.test && (
        <details className="group flex flex-col gap-2 border-t pt-3" open={ctx.wide}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 transition-transform group-open:rotate-90"
              aria-hidden
            />
            {t('askEzy.test.show')}
          </summary>
          <div className="mt-2">
            <TestResult test={block.test} compact />
          </div>
        </details>
      )}
      {error && (
        <div data-change-result>
          <Banner tone="warning" title={t('askEzy.change.conflictTitle')}>
            <p>{error}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" className="pointer-coarse:min-h-11" onClick={ctx.onAskAgain}>
                <RotateCcw aria-hidden />
                {t('askEzy.errors.askAgain')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="pointer-coarse:min-h-11"
                disabled={busy}
                onClick={() => ctx.onChange(block.id, 'discard')}
              >
                <X aria-hidden />
                {t('askEzy.change.discard')}
              </Button>
            </div>
          </Banner>
        </div>
      )}
      {status === 'proposed' && !error && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => ctx.onChange(block.id, 'apply')}
          >
            <Check aria-hidden />
            {t('askEzy.change.apply')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => ctx.onChange(block.id, 'discard')}
          >
            <X aria-hidden />
            {t('askEzy.change.discard')}
          </Button>
        </div>
      )}
      {status !== 'proposed' && (
        <div className="flex flex-col gap-1 text-sm" data-change-result>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => ctx.onChange(block.id, 'undo')}
            >
              {status === 'applied' ? <Undo2 aria-hidden /> : <RotateCcw aria-hidden />}
              {status === 'applied' ? t('askEzy.change.undo') : t('askEzy.change.showAgain')}
            </Button>
            <span className={status === 'applied' ? 'text-success' : 'text-muted-foreground'}>
              {status === 'applied'
                ? t('askEzy.change.appliedNote', { agent: block.agent })
                : t('askEzy.change.discardedNote')}
            </span>
          </div>
          {status === 'applied' && (
            <Link
              to="/admin/members/ai"
              onClick={ctx.onNavigate}
              className="flex min-h-11 items-center self-start text-primary underline-offset-4 hover:underline"
            >
              {t('askEzy.change.history')}
            </Link>
          )}
        </div>
      )}
    </Frame>
  );
}

export function AskEzyBlock({ block, ctx }: { block: AskBlock; ctx: BlockContext }) {
  switch (block.type) {
    case 'stats':
      return <StatsBlock block={block} />;
    case 'bars':
      return (
        <Frame title={block.title} finding={block.finding} testId="ask-block-bars">
          <RankedBars
            rows={block.rows.map((r) => ({ key: r.label, label: r.label, count: r.count }))}
          />
        </Frame>
      );
    case 'heatmap':
      return <HeatmapBlock block={block} />;
    case 'chats':
      return <ChatsBlock block={block} ctx={ctx} />;
    case 'customer':
      return <CustomerBlock block={block} ctx={ctx} />;
    case 'change':
      return <ChangeBlock block={block} ctx={ctx} />;
    case 'test':
      return <TestBlock test={block} />;
  }
}

function TestBlock({ test }: { test: AskTest }) {
  const { t } = useTranslation('inbox');
  return (
    <Frame title={t('askEzy.test.title')} testId="ask-block-test">
      <TestResult test={test} />
      <p className="text-xs text-muted-foreground">{t('askEzy.test.note')}</p>
    </Frame>
  );
}

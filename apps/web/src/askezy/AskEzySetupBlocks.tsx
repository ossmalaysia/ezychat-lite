import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, RotateCcw, Undo2, X } from 'lucide-react';
import type { AskEzyBlock as AskBlock } from '@ezychat/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/app';
import { cn } from '@/lib/utils';
import { useScheduledFormat } from '../admin/scheduled-format';
import type { BlockContext, ChangeState } from './AskEzyBlocks';

type Question = Extract<AskBlock, { type: 'question' }>;
type AgentCard = Extract<AskBlock, { type: 'agent_proposal' }>;
type TaskCard = Extract<AskBlock, { type: 'task_proposal' }>;

/**
 * Ask Ezy sets up agents and scheduled tasks (design docs/features/ask-ezy-setup/design.md): the question
 * with choices, the New agent card and the Scheduled task card. Nothing is saved until Apply.
 */

/** One question with tappable choices; a tap sends the choice as the person's next message. */
export function QuestionBlock({ block, ctx }: { block: Question; ctx: BlockContext }) {
  const answered = ctx.answered;
  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid="ask-block-question"
    >
      {block.note && (
        <Banner tone={block.tone === 'error' ? 'danger' : 'warning'}>
          <p>{block.note}</p>
        </Banner>
      )}
      <p className="text-sm font-medium">{block.text}</p>
      <ul className="flex flex-wrap gap-2">
        {block.choices.map((choice) => {
          const chosen = answered === choice;
          return (
            <li key={choice}>
              <Button
                variant="outline"
                size="sm"
                aria-pressed={answered !== null ? chosen : undefined}
                disabled={answered !== null || ctx.busy}
                className={cn(
                  'h-auto min-h-10 rounded-full px-4 py-1.5 text-left whitespace-normal pointer-coarse:min-h-11',
                  chosen && 'border-primary text-primary disabled:opacity-100',
                )}
                onClick={() => ctx.onAsk(choice)}
              >
                {choice}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function CardFrame({
  id,
  title,
  tag,
  children,
  testId,
}: {
  id: string;
  title: string;
  tag: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section
      className="flex min-w-0 scroll-mt-2 flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid={testId}
      data-change-id={id}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 tabIndex={-1} className="min-w-0 text-sm font-semibold break-words outline-none">
          {title}
        </h3>
        <Badge variant="secondary" className="shrink-0 uppercase">
          {tag}
        </Badge>
      </header>
      {children}
    </section>
  );
}

/** Apply / Discard, the "not saved" banner and Undo, shared by both cards. */
function CardActions({
  id,
  state,
  ctx,
  paired,
  appliedNote,
  links,
  undo = true,
}: {
  id: string;
  state: ChangeState;
  ctx: BlockContext;
  /** "Apply both" under the cards decides for this card. */
  paired: boolean;
  appliedNote: React.ReactNode;
  links?: React.ReactNode;
  undo?: boolean;
}) {
  const { t } = useTranslation('inbox');
  const { status, busy, error } = state;
  // Apply, Discard and Undo replace the button that had focus: keep focus on this card.
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(status);
  useEffect(() => {
    if (shown.current === status) return;
    shown.current = status;
    ref.current?.closest('section')?.querySelector<HTMLElement>('h3')?.focus();
  }, [status]);
  return (
    <div ref={ref} className="flex flex-col gap-2">
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
                onClick={() => ctx.onChange(id, 'discard')}
              >
                <X aria-hidden />
                {t('askEzy.change.discard')}
              </Button>
            </div>
          </Banner>
        </div>
      )}
      {status === 'proposed' && !error && !paired && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => ctx.onChange(id, 'apply')}
          >
            <Check aria-hidden />
            {t('askEzy.change.apply')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => ctx.onChange(id, 'discard')}
          >
            <X aria-hidden />
            {t('askEzy.change.discard')}
          </Button>
        </div>
      )}
      {status === 'applied' && (
        <div className="flex flex-col gap-2 text-sm" data-change-result>
          <p className="text-success">{appliedNote}</p>
          {undo && (
            <div>
              <Button
                size="sm"
                variant="outline"
                className="pointer-coarse:min-h-11"
                disabled={busy}
                onClick={() => ctx.onChange(id, 'undo')}
              >
                <Undo2 aria-hidden />
                {t('askEzy.change.undo')}
              </Button>
            </div>
          )}
          {links && <div className="flex flex-wrap gap-x-4">{links}</div>}
        </div>
      )}
      {status === 'discarded' && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-change-result>
          <Button
            size="sm"
            variant="outline"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => ctx.onChange(id, 'undo')}
          >
            <RotateCcw aria-hidden />
            {t('askEzy.change.showAgain')}
          </Button>
          <span className="text-muted-foreground">{t('askEzy.change.discardedNote')}</span>
        </div>
      )}
    </div>
  );
}

function PageLink({ to, ctx, children }: { to: string; ctx: BlockContext; children: string }) {
  return (
    <Link
      to={to}
      onClick={ctx.onNavigate}
      className="flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

const agentPage = (agentId: number) => `/admin/members/ai/${agentId}`;

export function AgentProposalBlock({ block, ctx }: { block: AgentCard; ctx: BlockContext }) {
  const { t } = useTranslation('inbox');
  const state = ctx.changes[block.id] ?? { status: block.status, agentId: block.agentId };
  const agentId = state.agentId ?? block.agentId;
  return (
    <CardFrame
      id={block.id}
      title={block.name}
      tag={t('askEzy.setup.newAgent')}
      testId={`ask-block-agent-${block.id}`}
    >
      {state.status !== 'applied' && (
        <>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <Row label={t('askEzy.setup.type')}>{t(`askEzy.setup.preset.${block.preset}`)}</Row>
            <Row label={t('askEzy.setup.number')}>{block.inboxName}</Row>
            {block.note && <Row label={t('askEzy.setup.does')}>{block.note}</Row>}
          </dl>
          <p className="text-xs text-muted-foreground">{t('askEzy.setup.startsOff')}</p>
        </>
      )}
      <CardActions
        id={block.id}
        state={state}
        ctx={ctx}
        paired={ctx.paired.has(block.id)}
        // Its task card's Undo removes both.
        undo={!ctx.linked.has(block.id)}
        appliedNote={t('askEzy.setup.created')}
        links={
          agentId && !ctx.linked.has(block.id) ? (
            <PageLink to={agentPage(agentId)} ctx={ctx}>
              {t('askEzy.setup.openAgent')}
            </PageLink>
          ) : undefined
        }
      />
    </CardFrame>
  );
}

export function TaskProposalBlock({ block, ctx }: { block: TaskCard; ctx: BlockContext }) {
  const { t } = useTranslation('inbox');
  const format = useScheduledFormat(block.timeZone);
  const state = ctx.changes[block.id] ?? { status: block.status };
  const agentId = state.agentId ?? block.agentId ?? undefined;
  const before = block.before;
  const chat = (name: string, ending: string | null | undefined) =>
    ending ? t('askEzy.setup.chatWithEnding', { name, ending }) : name;
  const schedule = format.schedule(block);
  const old =
    before && (before.time !== undefined || before.dayRule !== undefined)
      ? format.schedule({
          time: before.time ?? block.time,
          dayRule: before.dayRule ?? block.dayRule,
          days: before.days ?? block.days,
        })
      : null;
  const pending = state.status !== 'applied' && block.dependsOn !== null && !state.agentId;
  const applied = state.status === 'applied';
  return (
    <CardFrame
      id={block.id}
      title={block.name}
      tag={before ? t('askEzy.setup.changeTag') : t('askEzy.setup.scheduledTask')}
      testId={`ask-block-task-${block.id}`}
    >
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {!applied && (
          <Row label={t('askEzy.setup.agent')}>
            {pending ? t('askEzy.setup.newSuffix', { name: block.agent }) : block.agent}
          </Row>
        )}
        <Row label={t('askEzy.setup.sendTo')}>
          {before?.chatName !== undefined && !applied && (
            <>
              <span className="text-muted-foreground line-through">
                {chat(before.chatName, before.chatEnding)}
              </span>{' '}
              →{' '}
            </>
          )}
          <span className={cn(before?.chatName !== undefined && 'font-medium')}>
            {chat(block.chatName, block.chatEnding)}
          </span>
        </Row>
        <Row label={t('askEzy.setup.when')}>
          {old && !applied && (
            <>
              <span className="text-muted-foreground line-through">{old}</span> →{' '}
            </>
          )}
          <span className={cn(old && !applied && 'font-medium')}>
            {applied && state.nextRunAt
              ? t('askEzy.setup.whenNext', { schedule, next: format.when(state.nextRunAt) })
              : t('askEzy.setup.whenZone', { schedule, zone: block.timeZone })}
          </span>
        </Row>
        {!applied && (
          <Row label={t('askEzy.setup.instruction')}>
            {before?.instruction !== undefined && (
              <span className="block text-muted-foreground line-through">{before.instruction}</span>
            )}
            {block.instruction}
          </Row>
        )}
      </dl>
      {block.preview && !applied && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">{t('askEzy.setup.preview')}</p>
          <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
            {block.preview}
          </p>
        </div>
      )}
      <CardActions
        id={block.id}
        state={state}
        ctx={ctx}
        paired={ctx.paired.has(block.id)}
        appliedNote={state.agentOn ? t('askEzy.setup.saved') : t('askEzy.setup.savedOff')}
        links={
          agentId ? (
            <>
              <PageLink to={agentPage(agentId)} ctx={ctx}>
                {t('askEzy.setup.openAgent')}
              </PageLink>
              <PageLink to={`${agentPage(agentId)}#scheduled-tasks`} ctx={ctx}>
                {t('askEzy.setup.openTasks')}
              </PageLink>
            </>
          ) : undefined
        }
      />
    </CardFrame>
  );
}

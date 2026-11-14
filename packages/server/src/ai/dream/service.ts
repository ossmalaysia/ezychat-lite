import { DREAM_GRACE_MS, DREAM_PREVIEWS_PER_RUN, type DreamRunReason } from '@ezychat/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../db/audit.js';
import { latestSlot, toMinutes } from '../../scheduled/time.js';
import { agentById } from '../agents.js';
import { inboxCustomerNames } from '../customer-names.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../prompt.js';
import { DREAM_ACTOR, applySetupText } from '../setup-apply.js';
import { checkChange } from './checks.js';
import { collectTakeovers, questionsAnsweredByAi, type TakeoverChat } from './collect.js';
import type { DreamLesson, DreamProposal, DreamSetup } from './prompts.js';
import { DreamRepo, type RunResult } from './repo.js';

/**
 * Dream mode's nightly run (design §2–§7): a 60-second tick finds each enabled agent's night, runs it once within 60
 * minutes of its time (later: `missed`), one run at a time, and saves only changes that pass every check.
 */
export interface DreamService {
  /** Runs the agent's dream now (dev route and tests); the run id. */
  runNow(agentId: number): Promise<number | null>;
  /** One scheduler pass (the timer calls it; tests call it with a fake clock). */
  tick(): Promise<void>;
  shutdown(): Promise<void>;
}

declare module '../../context.js' {
  interface Services {
    dream?: DreamService;
  }
}

export const DREAM_TICK_MS = 60_000;
export const DREAM_START_DELAY_MS = 20_000;
const DAY = 24 * 60 * 60_000;

class AgentOff extends Error {}

/** Lessons with the chat each came from. */
interface Learned {
  lesson: DreamLesson;
  chat: TakeoverChat;
}

export function createDreamService(
  ctx: AppContext,
  deps: { now?: () => number; timers?: boolean } = {},
): DreamService {
  const now = deps.now ?? Date.now;
  const repo = new DreamRepo(ctx.db);
  const log = ctx.log.child({ mod: 'dream' });
  const abort = new AbortController();
  let ticking = false;
  let chain: Promise<unknown> = Promise.resolve();

  const timeZone = () => resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null));
  const agentOn = (agentId: number) => !!agentById(ctx.db, agentId)?.enabled;

  /** What stops the agent's run now; null = it runs. */
  const blocked = (agentId: number): Exclude<DreamRunReason, null> | null => {
    if (!ctx.access.state().open) return 'access_closed';
    if (!agentOn(agentId)) return 'agent_off';
    const ai = ctx.services.ai;
    if (!ai || ai.draftConnection() !== 'ready') return 'ai_unavailable';
    return null;
  };

  const targetText = (p: DreamProposal, setup: DreamSetup): string =>
    p.target === 'instructions'
      ? setup.instructions
      : p.target === 'handoff_rules'
        ? setup.handoffRules
        : p.itemId === null
          ? ''
          : (setup.items.find((i) => i.id === p.itemId)?.text ?? '');

  /** One night of one agent; records the run whatever happens. */
  const run = async (agentId: number, slot: number): Promise<number | null> => {
    const runId = repo.claimRun(agentId, slot, now());
    if (runId === null) return null;
    const counts = { chatsRead: 0, takeovers: 0, saved: 0, dropped: 0 };
    const finish = (status: RunResult['status'], reason: DreamRunReason = null) => {
      repo.finishRun(runId, { status, reason, ...counts }, now());
      log.info({ event: 'dream_run', agentId, runId, status, reason, ...counts }, 'Dream mode run');
      return runId;
    };
    const reason = blocked(agentId);
    if (reason) return finish('skipped', reason);
    const ai = ctx.services.ai!;
    const signal = abort.signal;
    try {
      const window = {
        agentId,
        from: Math.max(repo.lastFinishedAt(agentId) ?? 0, slot - DAY),
        to: slot,
      };
      const chats = collectTakeovers(ctx, window);
      counts.chatsRead = chats.length;
      counts.takeovers = chats.length;
      const learned: Learned[] = [];
      for (const chat of chats) {
        try {
          for (const lesson of await ai.dreamLessons(agentId, chat, signal))
            learned.push({ lesson, chat });
        } catch (error) {
          if (signal.aborted) throw error;
          log.warn({ event: 'dream_chat_failed', agentId, runId }, 'Dream mode skipped one chat');
        }
      }
      if (!learned.length) return finish('done');
      const { proposals, setup } = await ai.dreamMerge(
        agentId,
        learned.map((l) => l.lesson),
        signal,
      );
      const agent = agentById(ctx.db, agentId);
      const names = agent?.inboxId != null ? inboxCustomerNames(ctx.db, agent.inboxId) : [];
      const regression = questionsAnsweredByAi(ctx, window);
      const budget = { previews: DREAM_PREVIEWS_PER_RUN };
      for (const proposal of proposals) {
        const used = proposal.lessonIds
          .map((id) => learned[id - 1])
          .filter((l): l is Learned => !!l);
        const sources = [...new Set(used.map((l) => l.chat))];
        const cited = new Set(
          used.flatMap((l) => l.lesson.teamMessageIds.map((id) => `${l.chat.chatJid}#${id}`)),
        );
        const teamMessages = sources.flatMap((c) =>
          c.messages.filter((m) => m.role === 'team' && cited.has(`${c.chatJid}#${m.localId}`)),
        );
        const before = targetText(proposal, setup);
        const result = await checkChange(
          ctx,
          {
            agentId,
            proposal,
            before,
            sources,
            teamText: teamMessages.map((m) => m.text).join('\n'),
            regression,
            names,
            budget,
          },
          signal,
        );
        if (!agentOn(agentId)) throw new AgentOff();
        if (!result.ok) {
          counts.dropped++;
          continue;
        }
        const questions = sources.flatMap((c) =>
          c.messages.filter((m) => m.role === 'customer').slice(-1),
        );
        const change = {
          target: proposal.target,
          itemId: proposal.itemId,
          itemName:
            proposal.itemId === null
              ? proposal.name
              : (setup.items.find((i) => i.id === proposal.itemId)?.name ?? null),
          before,
          after: proposal.after,
          summary: proposal.summary.slice(0, 200),
          sourceMessageIds: [...questions, ...teamMessages].map((m) => m.messageId),
          checks: result.checks,
          createdAt: now(),
        };
        let applied: { itemId: number | null; versionId: number | null } | null = null;
        if (repo.settings(agentId).autoApply && proposal.target === 'context_text') {
          try {
            applied = applySetupText(
              ctx,
              {
                agentId,
                target: proposal.target,
                itemId: proposal.itemId,
                name: proposal.name,
                before,
                after: proposal.after,
              },
              DREAM_ACTOR(change.summary),
            );
          } catch {
            applied = null; // the text changed meanwhile: it waits for an admin instead
          }
        }
        const id = repo.addChange(runId, agentId, {
          ...change,
          itemId: applied?.itemId ?? change.itemId,
          status: applied ? 'applied' : 'waiting',
          auto: !!applied,
          versionId: applied?.versionId ?? null,
        });
        if (applied)
          audit(ctx.db, {
            userId: null,
            action: 'dream.change.applied',
            ip: null,
            meta: { changeId: id, agentId, auto: true },
          });
        counts.saved++;
      }
      return finish('done');
    } catch (error) {
      if (error instanceof AgentOff) return finish('skipped', 'agent_off');
      if (!signal.aborted)
        log.warn(
          { event: 'dream_run_failed', agentId, runId, err: (error as Error).name },
          'Dream mode run failed',
        );
      return finish('failed');
    }
  };

  /** Runs one after another (one dream at a time per install). */
  const queue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = chain.then(job, job);
    chain = next.catch(() => undefined);
    return next;
  };

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const at = now();
      repo.expireWaiting(at);
      for (const s of repo.enabledAgents()) {
        const slot = latestSlot(
          { timeMinutes: toMinutes(s.runTime), dayRule: 'daily', days: [] },
          at,
          timeZone(),
        );
        // A night that started before dream mode was set up (or its time changed) is not this night.
        if (slot === null || s.updatedAt > slot) continue;
        if (at - slot > DREAM_GRACE_MS) {
          const missed = repo.claimRun(s.agentId, slot, at);
          if (missed !== null)
            repo.finishRun(
              missed,
              { status: 'missed', reason: null, chatsRead: 0, takeovers: 0, saved: 0, dropped: 0 },
              at,
            );
          continue;
        }
        await queue(() => run(s.agentId, slot));
      }
    } finally {
      ticking = false;
    }
  };

  let every: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;
  if (deps.timers !== false) {
    first = setTimeout(() => {
      void tick();
      every = setInterval(() => void tick(), DREAM_TICK_MS);
      every.unref?.();
    }, DREAM_START_DELAY_MS);
    first.unref?.();
  }

  return {
    runNow: (agentId) => queue(() => run(agentId, now())),
    tick,
    async shutdown() {
      clearTimeout(first);
      clearInterval(every);
      abort.abort();
      await chain;
    },
  };
}

export function initDream(ctx: AppContext): void {
  if (ctx.services.ai) ctx.services.dream = createDreamService(ctx);
}

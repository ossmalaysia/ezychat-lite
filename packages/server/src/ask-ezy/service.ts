import type { ModelMessage } from 'ai';
import {
  ASK_EZY_CHOICE_CHARACTERS,
  ASK_EZY_CHOICES_MAX,
  AskEzyAnswer,
  AskEzyBlock,
  AskEzyTest,
  type AskEzyChangeResult,
  type AskEzyEvent,
  type AskEzyRequest,
  type AskEzyStep,
  type User,
} from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../http/errors.js';
import { createInboxReadPort } from '../mcp/inbox.js';
import { createAiSetupPort } from '../mcp/ai-setup.js';
import { AgentTurnFailure, errorNameOf } from '../ai/agent/models.js';
import type { AssistOutput } from '../ai/agent/assist.js';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import { createChangeStore, lineDiff, type ChangeStore } from './changes.js';
import { askEzyInstructions } from './prompt.js';
import { createSetupStore, type SetupStore } from './setup.js';
import { askEzyTools } from './tools.js';

const MAX_BLOCKS = 8;
const MAX_FOLLOW_UPS = 3;
const DEFAULT_TITLE = {
  instructions: 'AI instructions',
  handoff_rules: 'Hand-off rules',
} as const;

/**
 * At most `max` UTF-16 units, as zod's `.max()` counts them, cut between characters (never inside an emoji),
 * so a clipped text still passes the block contract.
 */
export const clip = (text: string, max: number) => {
  const t = text.trim();
  if (t.length <= max) return t;
  let out = '';
  for (const ch of t) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return out + '…';
};

export interface AskEzyService {
  changes: ChangeStore;
  setup: SetupStore;
  /** Apply, discard or undo a proposal of this admin: a setup change, a new agent or a scheduled task. */
  act(
    id: string,
    action: 'apply' | 'discard' | 'undo',
    user: User,
    ip: string | null,
  ): AskEzyChangeResult;
  /** `connected`: a question can be answered now (the panel checks it on open). */
  status(): { connected: boolean };
  /**
   * Answers one question: emits a `step` per tool call, then one `answer` or `error` event. Throws an
   * HttpError before the first event when no question can be asked (no connection, unknown chat).
   */
  ask(
    user: User,
    request: AskEzyRequest,
    emit: (event: AskEzyEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

/**
 * Each Ask Ezy turn's total time: the fast turn, and the main-model setup turn after `start_setup` (it may
 * run a preview inside a tool). After it the turn stops and the person gets `ai_timeout`.
 */
export const ASK_EZY_FAST_BUDGET_MS = 90_000;
export const ASK_EZY_SETUP_BUDGET_MS = 150_000;

export function createAskEzyService(
  ctx: AppContext,
  opts: { fastBudgetMs?: number; setupBudgetMs?: number } = {},
): AskEzyService {
  const budgets = {
    fastMs: opts.fastBudgetMs ?? ASK_EZY_FAST_BUDGET_MS,
    mainMs: opts.setupBudgetMs ?? ASK_EZY_SETUP_BUDGET_MS,
  };
  const log = ctx.log.child({ mod: 'ask-ezy' });
  const changes = createChangeStore(ctx);
  const setup = createSetupStore(ctx);
  const inbox = createInboxReadPort(ctx);
  const aiSetup = createAiSetupPort(ctx);

  const connection = () => ctx.services.ai?.assistConnection() ?? 'none';

  /** Keeps a block only when it passes the contract and names nothing the user may not open. */
  function block(user: User, raw: AssistOutput['blocks'][number]): AskEzyBlock | null {
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw.json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      data = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    if (raw.type === 'agent_proposal' || raw.type === 'task_proposal')
      return setupBlock(user, raw.type, data);
    if (raw.type === 'question') {
      // Lenient on length: keep the first choices and short labels rather than drop the question.
      if (Array.isArray(data.choices))
        data.choices = data.choices
          .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
          .map((c) => clip(c, ASK_EZY_CHOICE_CHARACTERS))
          .slice(0, ASK_EZY_CHOICES_MAX);
      if (typeof data.text === 'string') data.text = clip(data.text, 400);
      if (typeof data.note === 'string') data.note = clip(data.note, 400);
    }
    if (raw.type === 'change') {
      if (user.role !== 'admin' || typeof data.id !== 'string') return null;
      const c = changes.get(data.id, user);
      if (!c) return null;
      const test = AskEzyTest.safeParse(data.test);
      const title =
        typeof data.title === 'string' && data.title.trim()
          ? clip(data.title, 200)
          : (c.itemName ?? DEFAULT_TITLE[c.target as keyof typeof DEFAULT_TITLE] ?? 'AI setup');
      const parsed = AskEzyBlock.safeParse({
        type: 'change',
        id: c.id,
        agent: c.agentName,
        title,
        target: c.target,
        itemName: c.itemName,
        ...lineDiff(c.before, c.after),
        before: c.before,
        after: c.after,
        reason: clip(c.reason, 600),
        ...(test.success ? { test: test.data } : {}),
        status: c.status,
        ...(c.version ? { version: c.version } : {}),
      });
      return parsed.success ? parsed.data : null;
    }
    const parsed = AskEzyBlock.safeParse({ ...data, type: raw.type });
    if (!parsed.success) return null;
    const b = parsed.data;
    // A chat the user may not open never shows, even if the model wrote its id.
    const canOpen = (jid: string) => inbox.getChat(jid, user) !== null;
    if (b.type === 'chats') {
      const chats = b.chats.filter((c) => canOpen(c.jid));
      return chats.length ? { ...b, chats } : null;
    }
    if (b.type === 'customer') return canOpen(b.jid) ? b : null;
    return b;
  }

  /** A new-agent or scheduled-task card, filled from the held proposal (the model gives only its id). */
  function setupBlock(
    user: User,
    type: 'agent_proposal' | 'task_proposal',
    data: Record<string, unknown>,
  ): AskEzyBlock | null {
    if (user.role !== 'admin' || typeof data.id !== 'string') return null;
    const p = setup.get(data.id, user);
    if (!p) return null;
    if (type === 'agent_proposal') {
      if (p.kind !== 'agent') return null;
      const parsed = AskEzyBlock.safeParse({
        type,
        id: p.id,
        name: p.name,
        preset: p.preset,
        inboxName: clip(p.inboxName, 200),
        note: p.note,
        status: p.status,
        ...(p.agentId ? { agentId: p.agentId } : {}),
        removable: setup.agentsRemovable(),
      });
      return parsed.success ? parsed.data : null;
    }
    if (p.kind !== 'task') return null;
    const parsed = AskEzyBlock.safeParse({
      type,
      id: p.id,
      agent: clip(p.agentName, 200),
      agentId: p.agentId,
      dependsOn: p.agentId === null ? p.dependsOn : null,
      name: p.spec.name,
      time: p.spec.time,
      dayRule: p.spec.dayRule,
      days: p.spec.days,
      chatName: p.chat.name === null ? null : clip(p.chat.name, 200),
      chatEnding: p.chat.ending,
      chatType: p.chat.type,
      instruction: p.spec.instruction,
      timeZone: p.timeZone,
      preview: p.preview === null ? null : clip(p.preview, 4000),
      ...(p.previewTimedOut ? { previewTimedOut: true } : {}),
      before: p.edit ? p.edit.before : null,
      ...(p.taskId ? { taskId: p.taskId } : p.edit ? { taskId: p.edit.taskId } : {}),
      status: p.status,
    });
    return parsed.success ? parsed.data : null;
  }

  /**
   * A new agent comes only with its scheduled task (owner decision 2026-11-12): an agent card without a task
   * card that needs it is left out, with a note that asks what it should send; a task card of a pending new
   * agent brings that agent's card when the model left it out.
   */
  function withSetupRules(user: User, blocks: AskEzyBlock[]): AskEzyBlock[] {
    const needed = new Set(
      blocks.flatMap((b) => (b.type === 'task_proposal' && b.dependsOn ? [b.dependsOn] : [])),
    );
    const shown = new Set(blocks.flatMap((b) => (b.type === 'agent_proposal' ? [b.id] : [])));
    const out: AskEzyBlock[] = [];
    let noted = false;
    for (const b of blocks) {
      if (b.type === 'agent_proposal' && !needed.has(b.id) && b.status !== 'applied') {
        if (!noted) out.push({ type: 'setup_note', code: 'agent_needs_task' });
        noted = true;
        continue;
      }
      if (b.type === 'task_proposal' && b.dependsOn && !shown.has(b.dependsOn)) {
        const agent = setupBlock(user, 'agent_proposal', { id: b.dependsOn });
        if (agent) out.push(agent);
        shown.add(b.dependsOn);
      }
      out.push(b);
    }
    return out;
  }

  /** Tool calls in order, repeated calls of one tool merged (their row counts added). */
  function mergeSteps(calls: Array<{ tool: string; count: number; ok: boolean }>): AskEzyStep[] {
    const steps: AskEzyStep[] = [];
    for (const c of calls) {
      if (!c.ok) continue;
      const seen = steps.find((s) => s.key === c.tool);
      if (seen) seen.count = (seen.count ?? 0) + c.count;
      else steps.push({ key: c.tool, count: c.count });
    }
    return steps.slice(0, 12);
  }

  return {
    changes,
    setup,

    act(id, action, user, ip) {
      // A new agent or scheduled task, else a change to the AI setup.
      const store = setup.has(id, user) ? setup : null;
      if (action === 'apply')
        return store ? store.apply(id, user, ip) : changes.apply(id, user, ip);
      if (action === 'discard') return store ? store.discard(id, user) : changes.discard(id, user);
      return store ? store.undo(id, user, ip) : changes.undo(id, user, ip);
    },

    status() {
      return { connected: connection() === 'ready' };
    },

    async ask(user, request, emit, signal) {
      const ai = ctx.services.ai;
      const state = connection();
      if (!ai || state === 'none')
        throw new HttpError(409, 'ai_not_connected', 'Connect an AI provider in Settings → AI');
      if (state === 'expired') throw new HttpError(409, 'ai_expired', 'The AI sign-in expired');
      if (state !== 'ready')
        throw new HttpError(503, 'ai_unavailable', 'The AI is not available now');
      let chat: { jid: string; name: string } | null = null;
      if (request.chatJid) {
        const found = inbox.getChat(request.chatJid, user);
        if (!found) throw new HttpError(404, 'chat_not_found', 'Chat not found');
        chat = { jid: found.chat.jid, name: found.chat.name ?? found.chat.jid };
      }
      const started = Date.now();
      const calls: Array<{ tool: string; count: number; ok: boolean; ms: number }> = [];
      // `start_setup` ends the fast turn: the same request then runs on the main model with the setup tools.
      const setupStart = new AbortController();
      let setupRequested = false;
      const toolsFor = (mode: 'normal' | 'setup', turnSignal: AbortSignal) =>
        askEzyTools({
          user,
          inbox,
          aiSetup,
          changes,
          setup,
          signal: turnSignal,
          mode,
          onStartSetup: () => {
            setupRequested = true;
            setupStart.abort();
          },
          onCall: (call) => {
            if (call.tool === 'start_setup') return;
            calls.push(call);
            if (call.errName)
              log.warn({ tool: call.tool, errName: call.errName }, 'Ask Ezy tool failed');
            if (call.ok) emit({ type: 'step', key: call.tool, count: call.count });
          },
        });
      const messages: ModelMessage[] = [
        ...request.history.map((turn): ModelMessage =>
          turn.role === 'user'
            ? { role: 'user', content: turn.text }
            : { role: 'assistant', content: turn.text },
        ),
        { role: 'user', content: request.question },
      ];
      const instructionsFor = (setupTurn: boolean) =>
        askEzyInstructions({
          isAdmin: user.role === 'admin',
          userName: user.displayName,
          timeZone: resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null)),
          now: new Date(),
          chat,
          maxAgents: ai.maxAgents(),
          setup: setupTurn,
        });
      let setupTurn = false;
      let budgetHit = false;
      /**
       * One model turn inside its total budget: the model call and its tools stop with it, and the turn ends
       * even when a provider never answers (the person never waits without an answer or an error).
       */
      const turn = async (
        mode: 'normal' | 'setup',
        outer: AbortSignal,
        ms: number,
      ): Promise<Awaited<ReturnType<typeof ai.assist>>> => {
        const budget = new AbortController();
        const timer = setTimeout(() => {
          budgetHit = true;
          budget.abort();
        }, ms);
        const turnSignal = AbortSignal.any([outer, budget.signal]);
        const stopped = new Promise<never>((_resolve, reject) =>
          turnSignal.addEventListener('abort', () => reject(new Error('turn stopped')), {
            once: true,
          }),
        );
        const work = ai.assist(
          {
            instructions: instructionsFor(mode === 'setup'),
            messages,
            tools: toolsFor(mode, turnSignal),
            ...(mode === 'setup' ? { main: true } : {}),
          },
          turnSignal,
        );
        work.catch(() => {});
        stopped.catch(() => {});
        try {
          return await Promise.race([work, stopped]);
        } finally {
          clearTimeout(timer);
          budget.abort();
        }
      };
      try {
        let result: Awaited<ReturnType<typeof ai.assist>> | null = null;
        try {
          result = await turn(
            'normal',
            AbortSignal.any([signal, setupStart.signal]),
            budgets.fastMs,
          );
        } catch (error) {
          if (!setupRequested || signal.aborted || budgetHit) throw error;
        }
        if (setupRequested) {
          setupTurn = true;
          log.info(
            {
              event: 'ask_ezy_setup_start',
              fastModel: result?.model ?? null,
              ms: Date.now() - started,
            },
            'Ask Ezy setup turn on the main model',
          );
          result = await turn('setup', signal, budgets.mainMs);
        }
        if (!result) throw new Error('no answer');
        const all = result.output.blocks.slice(0, MAX_BLOCKS * 2).map((raw) => block(user, raw));
        const blocks = withSetupRules(
          user,
          all.filter((b): b is AskEzyBlock => b !== null),
        ).slice(0, MAX_BLOCKS);
        const answer = AskEzyAnswer.parse({
          text: clip(result.output.text, 4000) || '…',
          blocks,
          steps: mergeSteps(calls),
          followUps: result.output.followUps
            .map((f) => clip(f, 200))
            .filter(Boolean)
            .slice(0, MAX_FOLLOW_UPS),
        });
        emit({ type: 'answer', answer });
        log.info(
          {
            event: 'ask_ezy',
            role: user.role,
            tools: calls.map((c) => c.tool),
            steps: result.steps,
            blocks: blocks.length,
            dropped: all.length - blocks.length,
            ms: Date.now() - started,
            model: result.model,
            ...(setupTurn ? { setup: true } : {}),
            ...(result.repaired ? { repaired: true } : {}),
          },
          'Ask Ezy answered',
        );
      } catch (error) {
        if (signal.aborted) {
          log.info(
            { event: 'ask_ezy', stopped: true, ms: Date.now() - started },
            'Ask Ezy stopped',
          );
          return;
        }
        if (budgetHit) {
          // The turn's total budget ran out: counts and names only, never text.
          log.warn(
            {
              event: 'ask_ezy',
              code: 'ai_timeout',
              kind: 'budget',
              setup: setupTurn,
              budgetMs: setupTurn ? budgets.mainMs : budgets.fastMs,
              toolCalls: calls.length,
              tools: calls.map((c) => c.tool),
              ms: Date.now() - started,
            },
            'Ask Ezy took too long',
          );
          emit({ type: 'error', code: 'ai_timeout' });
          return;
        }
        const failure = error instanceof AgentTurnFailure ? error : null;
        const code =
          failure?.kind === 'timeout'
            ? 'ai_timeout'
            : connection() === 'expired'
              ? 'ai_expired'
              : 'ai_unavailable';
        // Class name, kind and status only: messages can echo the question or tool results.
        log.warn(
          {
            event: 'ask_ezy',
            code,
            kind: failure?.kind ?? 'other',
            errName: failure?.causeName ?? errorNameOf(error),
            status: failure?.status ?? null,
            finishReason: failure?.finishReason ?? null,
            answerShape: failure?.answerShape ?? null,
            setup: setupTurn,
            tools: calls.map((c) => c.tool),
            ms: Date.now() - started,
          },
          'Ask Ezy could not answer',
        );
        emit({ type: 'error', code });
      }
    },
  };
}

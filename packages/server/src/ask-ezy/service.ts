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

const clip = (text: string, max: number) => {
  const t = text.trim();
  return [...t].length > max ? [...t].slice(0, max - 1).join('') + '…' : t;
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

export function createAskEzyService(ctx: AppContext): AskEzyService {
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
      chatName: clip(p.chat.name, 200),
      chatEnding: p.chat.ending,
      chatType: p.chat.type,
      instruction: p.spec.instruction,
      timeZone: p.timeZone,
      preview: p.preview === null ? null : clip(p.preview, 4000),
      before: p.edit ? p.edit.before : null,
      ...(p.taskId ? { taskId: p.taskId } : p.edit ? { taskId: p.edit.taskId } : {}),
      status: p.status,
    });
    return parsed.success ? parsed.data : null;
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
      const tools = askEzyTools({
        user,
        inbox,
        aiSetup,
        changes,
        setup,
        onCall: (call) => {
          calls.push(call);
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
      const instructions = askEzyInstructions({
        isAdmin: user.role === 'admin',
        userName: user.displayName,
        timeZone: resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null)),
        now: new Date(),
        chat,
        maxAgents: ai.maxAgents(),
      });
      try {
        const result = await ai.assist({ instructions, messages, tools }, signal);
        const all = result.output.blocks.slice(0, MAX_BLOCKS * 2).map((raw) => block(user, raw));
        const blocks = all.filter((b): b is AskEzyBlock => b !== null).slice(0, MAX_BLOCKS);
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
            ms: Date.now() - started,
          },
          'Ask Ezy could not answer',
        );
        emit({ type: 'error', code });
      }
    },
  };
}

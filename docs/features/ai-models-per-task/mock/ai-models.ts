import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireAdmin } from '../../../../packages/server/src/auth/guards.js';
import { HttpError, parse } from '../../../../packages/server/src/http/errors.js';
import { audit } from '../../../../packages/server/src/db/audit.js';

/**
 * Proposed (ai-models-per-task): a stand-in for the future `GET/PUT /api/ai/task-models` routes.
 * Each connection (ChatGPT sign-in, OpenAI key, Claude key) keeps its own choices; the dashed
 * "Mock only" strip switches the connection and removes a saved model from the list. No model is
 * ever called; everything lives in memory and is lost when the mock restarts.
 */

export const AI_TASKS = ['agentReplies', 'askEzy', 'translate', 'writing', 'background'] as const;
type Task = (typeof AI_TASKS)[number];
const Mode = z.enum(['chatgpt', 'api', 'claude']);
type Mode = z.infer<typeof Mode>;
const Thinking = z.enum(['low', 'medium', 'high']);
type Thinking = z.infer<typeof Thinking>;
type Tier = 'fast' | 'balanced' | 'smart';

interface ModelInfo {
  id: string;
  thinking: boolean;
  tier: Tier | null;
}

interface Choice {
  choice: string;
  thinking?: Thinking;
}

/** The demo connections: the saved main model, the fast model and what the connection lists. */
const CONNECTIONS: Record<Mode, { main: string; fast: string; models: ModelInfo[] }> = {
  chatgpt: {
    main: 'gpt-6.1-sol',
    fast: 'gpt-6-luna',
    models: [
      { id: 'gpt-6.1-sol', thinking: true, tier: 'smart' },
      { id: 'gpt-6-astra', thinking: true, tier: 'balanced' },
      { id: 'gpt-6-sol', thinking: true, tier: 'smart' },
      { id: 'gpt-6-luna', thinking: true, tier: 'fast' },
      { id: 'gpt-5.6-sol', thinking: true, tier: 'balanced' },
      { id: 'gpt-5.6-terra', thinking: true, tier: 'balanced' },
      { id: 'gpt-5.6-luna', thinking: true, tier: 'fast' },
      { id: 'gpt-5.5', thinking: true, tier: 'balanced' },
    ],
  },
  api: {
    main: 'gpt-4.1',
    fast: 'gpt-4.1-mini',
    models: [
      { id: 'gpt-4.1-mini', thinking: false, tier: 'fast' },
      { id: 'gpt-4.1', thinking: false, tier: 'balanced' },
      { id: 'gpt-5.5', thinking: true, tier: 'smart' },
    ],
  },
  claude: {
    main: 'claude-sonnet-5-5',
    fast: 'claude-haiku-5-5',
    models: [
      { id: 'claude-haiku-5-5', thinking: false, tier: 'fast' },
      { id: 'claude-sonnet-5-5', thinking: false, tier: 'balanced' },
      { id: 'claude-opus-5-5', thinking: false, tier: 'smart' },
    ],
  },
};

/** Defaults = today's behaviour, except Translate (Fast everywhere, owner 2026-11-22). */
const DEFAULTS: Record<Task, Choice> = {
  agentReplies: { choice: 'main' },
  askEzy: { choice: 'fast' },
  translate: { choice: 'fast' },
  writing: { choice: 'fast' },
  background: { choice: 'fast' },
};

/** A saved choice that is no longer listed falls back here: agent replies to Main, the rest to Fast. */
const FALLBACK: Record<Task, 'fast' | 'main'> = {
  agentReplies: 'main',
  askEzy: 'fast',
  translate: 'fast',
  writing: 'fast',
  background: 'fast',
};

const REMOVED_MODEL = 'gpt-5.6-terra';

interface State {
  mode: Mode;
  /** Mock only: the ChatGPT account stopped listing REMOVED_MODEL. */
  removed: boolean;
  saved: Record<Mode, Partial<Record<Task, Choice>>>;
}

const state: State = {
  mode: 'chatgpt',
  removed: false,
  saved: { chatgpt: {}, api: {}, claude: {} },
};

const listed = (mode: Mode): ModelInfo[] =>
  CONNECTIONS[mode].models.filter(
    (m) => !(mode === 'chatgpt' && state.removed && m.id === REMOVED_MODEL),
  );

function resolve(mode: Mode, task: Task) {
  const connection = CONNECTIONS[mode];
  const models = listed(mode);
  const saved = state.saved[mode][task] ?? DEFAULTS[task];
  let choice = saved.choice;
  let unavailable: string | null = null;
  if (choice !== 'fast' && choice !== 'main' && !models.some((m) => m.id === choice)) {
    unavailable = choice;
    choice = FALLBACK[task];
  }
  const model = choice === 'fast' ? connection.fast : choice === 'main' ? connection.main : choice;
  const info = models.find((m) => m.id === model);
  const supports = info?.thinking ?? false;
  // Today: ChatGPT draft calls (everything but agent replies) always run at Low; agent replies use the model's own.
  const defaultThinking: Thinking = task === 'agentReplies' && choice !== 'fast' ? 'medium' : 'low';
  return {
    choice: saved.choice,
    thinking: saved.thinking ?? null,
    model,
    effectiveThinking: supports
      ? unavailable
        ? defaultThinking
        : (saved.thinking ?? defaultThinking)
      : null,
    unavailable,
    isDefault: !state.saved[mode][task],
  };
}

function status() {
  const mode = state.mode;
  return {
    mode,
    mainModel: CONNECTIONS[mode].main,
    fastModel: CONNECTIONS[mode].fast,
    models: listed(mode),
    tasks: Object.fromEntries(AI_TASKS.map((task) => [task, resolve(mode, task)])),
    defaults: DEFAULTS,
    removedScenario: state.removed,
  };
}

const ChoiceBody = z
  .object({
    choice: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    thinking: Thinking.optional(),
  })
  .strict();
const Body = z
  .object({
    tasks: z
      .object(Object.fromEntries(AI_TASKS.map((t) => [t, ChoiceBody.nullable().optional()])))
      .strict(),
  })
  .strict();
const ScenarioBody = z.object({ mode: Mode.optional(), removed: z.boolean().optional() }).strict();

export function registerAiModels(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/mock/ai-models', { preHandler: requireAdmin(ctx) }, async () => status());

  app.put('/api/mock/ai-models', { preHandler: requireAdmin(ctx) }, async (req) => {
    const body = parse(Body, req.body);
    const mode = state.mode;
    const models = listed(mode);
    for (const [task, value] of Object.entries(body.tasks) as [Task, Choice | null | undefined][]) {
      if (value === undefined) continue;
      if (
        value &&
        value.choice !== 'fast' &&
        value.choice !== 'main' &&
        !models.some((m) => m.id === value.choice)
      )
        throw new HttpError(400, 'model_not_listed', 'Choose a model this AI connection offers.');
      const model =
        value?.choice === 'fast'
          ? CONNECTIONS[mode].fast
          : value?.choice === 'main'
            ? CONNECTIONS[mode].main
            : value?.choice;
      if (value?.thinking && !models.find((m) => m.id === model)?.thinking)
        throw new HttpError(400, 'thinking_not_supported', 'This model has no thinking level.');
    }
    for (const [task, value] of Object.entries(body.tasks) as [Task, Choice | null | undefined][]) {
      if (value === undefined) continue;
      const before = resolve(mode, task);
      if (value === null) delete state.saved[mode][task];
      else
        state.saved[mode][task] = {
          choice: value.choice,
          ...(value.thinking ? { thinking: value.thinking } : {}),
        };
      const after = resolve(mode, task);
      if (before.choice !== after.choice || before.thinking !== after.thinking)
        audit(ctx.db, {
          userId: req.user!.id,
          action: 'settings.ai_task_model',
          ip: req.ip,
          meta: {
            mode,
            task,
            before: { choice: before.choice, thinking: before.thinking },
            after: { choice: after.choice, thinking: after.thinking },
          },
        });
    }
    return status();
  });

  app.put('/api/mock/ai-models/scenario', { preHandler: requireAdmin(ctx) }, async (req) => {
    const body = parse(ScenarioBody, req.body);
    if (body.mode) state.mode = body.mode;
    if (body.removed !== undefined) {
      state.removed = body.removed;
      // The demo: Translate was set to gpt-5.6-terra on ChatGPT before the account dropped it.
      if (body.removed) state.saved.chatgpt.translate = { choice: REMOVED_MODEL, thinking: 'low' };
      else if (state.saved.chatgpt.translate?.choice === REMOVED_MODEL)
        delete state.saved.chatgpt.translate;
    }
    return status();
  });
}

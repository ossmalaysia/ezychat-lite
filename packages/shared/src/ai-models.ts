import { z } from 'zod';
import { AiConnectionMode } from './ai.js';

/**
 * AI models per task (design docs/features/ai-models-per-task/design.md, lasting rules docs/ai-models.md).
 * Settings → AI → AI models: five rows, each Fast, Main model or a model the current connection lists, plus
 * "Speed and quality" (Faster · Balanced · Smarter = reasoning low · medium · high) for models that have it.
 * Stored per connection mode in the setting `ai_task_models`; a missing row is its default.
 */
export const AI_TASK_GROUPS = [
  'agentReplies',
  'askEzy',
  'translate',
  'writing',
  'background',
] as const;
export const AiTaskGroup = z.enum(AI_TASK_GROUPS);
export type AiTaskGroup = z.infer<typeof AiTaskGroup>;

/** Speed and quality: `low` = Faster, `medium` = Balanced, `high` = Smarter (the reasoning effort sent). */
export const AiThinking = z.enum(['low', 'medium', 'high']);
export type AiThinking = z.infer<typeof AiThinking>;

/** `fast` (the connection's fast model), `main` (the AI connection card's model) or a model id it lists. */
export const AiTaskChoice = z.union([
  z.literal('fast'),
  z.literal('main'),
  // Any id the connection lists (an OpenAI key may name a fine-tuned `ft:…` model); the server checks the list.
  z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[^\s\p{Cc}]+$/u),
]);
export type AiTaskChoice = z.infer<typeof AiTaskChoice>;

export const AiTaskModel = z.strictObject({
  choice: AiTaskChoice,
  thinking: AiThinking.optional(),
});
export type AiTaskModel = z.infer<typeof AiTaskModel>;

/** Setting `ai_task_models`: per connection mode, per row. */
export const AiTaskModelsSetting = z.partialRecord(
  AiConnectionMode,
  z.partialRecord(AiTaskGroup, AiTaskModel),
);
export type AiTaskModelsSetting = z.infer<typeof AiTaskModelsSetting>;

/** Each row's default: the behaviour before the feature, except Translate (Fast, owner 2026-11-22). */
export const AI_TASK_DEFAULTS: Record<AiTaskGroup, 'fast' | 'main'> = {
  agentReplies: 'main',
  askEzy: 'fast',
  translate: 'fast',
  writing: 'fast',
  background: 'fast',
};

/**
 * The level a row uses when none is saved: Balanced (the model's own; nothing is sent) for AI agent replies on a
 * model other than Fast and for every row on an OpenAI key (no OpenAI-key call sent a level before), Faster
 * everywhere else (what every ChatGPT draft call sent before).
 */
export function defaultTaskThinking(
  group: AiTaskGroup,
  choice: AiTaskChoice,
  mode?: AiConnectionMode,
): AiThinking {
  if (mode === 'api') return 'medium';
  return group === 'agentReplies' && choice !== 'fast' ? 'medium' : 'low';
}

export const AiModelTier = z.enum(['fast', 'balanced', 'smart']);
export type AiModelTier = z.infer<typeof AiModelTier>;

/**
 * Whether a model of a connection takes a reasoning level: every ChatGPT model, the OpenAI reasoning models
 * on a key (gpt-5…, o-series). Claude: none (extended thinking is phase 2).
 */
export function aiModelHasThinking(mode: AiConnectionMode, model: string): boolean {
  if (mode === 'chatgpt') return true;
  // Chat variants (gpt-5-chat-latest), o1-mini/o1-preview and the -pro models take no (or a fixed) level.
  if (mode === 'api')
    return /^(gpt-5|o[1-9])/.test(model) && !/-chat|^o1-(mini|preview)|-pro\b/.test(model);
  return false;
}

/** A plain tier for a known model (null = unknown, no tier shown). */
export function aiModelTier(mode: AiConnectionMode, model: string): AiModelTier | null {
  if (/luna|mini|haiku/.test(model)) return 'fast';
  if (/(^|-)sol$|opus/.test(model)) return 'smart';
  if (model === 'gpt-5.5') return mode === 'api' ? 'smart' : 'balanced';
  if (/astra|terra|sonnet|^gpt-4\.1$/.test(model)) return 'balanced';
  return null;
}

export const AiModelInfo = z.object({
  id: z.string(),
  thinking: z.boolean(),
  tier: AiModelTier.nullable(),
});
export type AiModelInfo = z.infer<typeof AiModelInfo>;

export const AiTaskModelState = z.object({
  /** The saved choice (the default when none is saved). */
  choice: AiTaskChoice,
  /** The saved level; null = the default. */
  thinking: AiThinking.nullable(),
  /** The model that runs now (after the fallback). */
  model: z.string(),
  /** The level that runs now; null = the model has none. */
  effectiveThinking: AiThinking.nullable(),
  /** A saved model the connection no longer lists: the row runs on Main (agent replies) or Fast. */
  unavailable: z.string().nullable(),
  isDefault: z.boolean(),
});
export type AiTaskModelState = z.infer<typeof AiTaskModelState>;

/** `GET /api/ai/task-models` and the `PUT` answer (admins): the current connection's rows. */
export const AiTaskModelsStatus = z.object({
  mode: AiConnectionMode,
  mainModel: z.string(),
  fastModel: z.string(),
  models: z.array(AiModelInfo),
  tasks: z.record(AiTaskGroup, AiTaskModelState),
  defaults: z.record(AiTaskGroup, z.object({ choice: z.enum(['fast', 'main']) })),
});
export type AiTaskModelsStatus = z.infer<typeof AiTaskModelsStatus>;

/** `PUT /api/ai/task-models`: only the rows that change; null = back to the default. Current connection only. */
export const AiTaskModelsBody = z.strictObject({
  tasks: z.partialRecord(AiTaskGroup, AiTaskModel.nullable()),
});
export type AiTaskModelsBody = z.infer<typeof AiTaskModelsBody>;

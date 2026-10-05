import { z } from 'zod';
import { UserSchema } from './models.js';

/** EXPERIMENTAL direct ChatGPT sign-in: documented fallback when the live model list is unavailable
 * (ids from Codex 0.160's model list, visibility "list", by priority). The server validates a saved
 * model against the live list (or this list); '' means Auto. */
export const CHATGPT_FALLBACK_MODELS = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
] as const;
export const CHATGPT_MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Business context limit; also the size up to which all knowledge is sent without selection. */
export const AI_CONTEXT_CHARACTERS = 40_000;

export const AiSettingsBody = z.object({
  displayName: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  mode: z.enum(['api', 'chatgpt']),
  model: z.string().trim().max(128),
  instructions: z.string().max(8000),
  /** Business context: hours, prices, delivery, policies, FAQs (plus uploaded documents). */
  context: z.string().max(AI_CONTEXT_CHARACTERS),
  apiKey: z.string().trim().min(10).max(512).optional(),
});
export type AiSettingsBody = z.infer<typeof AiSettingsBody>;
export const AiSettings = AiSettingsBody.omit({ apiKey: true });
export type AiSettings = z.infer<typeof AiSettings>;
/** One connection/model shared by every current and future AI member. */
export const AiConnectionBody = AiSettingsBody.pick({
  mode: true,
  model: true,
  apiKey: true,
}).refine(({ mode, model }) => mode !== 'chatgpt' || !model || CHATGPT_MODEL_ID.test(model), {
  path: ['model'],
  message: 'ChatGPT mode supports only listed model ids. Choose Auto to use the default.',
});
export type AiConnectionBody = z.infer<typeof AiConnectionBody>;
export const AiMemberBody = AiSettings.omit({ mode: true, model: true });
export type AiMemberBody = z.infer<typeof AiMemberBody>;

export const AiDocument = z.object({
  id: z.number().int(),
  name: z.string(),
  size: z.number(),
  characters: z.number(),
  createdAt: z.number(),
});
export type AiDocument = z.infer<typeof AiDocument>;
export const AiConnection = z.object({
  state: z.enum(['unavailable', 'signed_out', 'signing_in', 'connected', 'error', 'expired']),
  loginUrl: z.string().nullable(),
  error: z.string().nullable(),
  /** Signed-in ChatGPT account email (direct sign-in only). */
  email: z.string().nullable().optional(),
});
export type AiConnection = z.infer<typeof AiConnection>;
export const AiMemberStatus = z.object({
  member: UserSchema.nullable(),
  settings: AiSettings,
  hasApiKey: z.boolean(),
  connection: AiConnection,
  documents: z.array(AiDocument),
});
export type AiMemberStatus = z.infer<typeof AiMemberStatus>;

export const AiModelList = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  source: z.enum(['live', 'fallback']),
});
export type AiModelList = z.infer<typeof AiModelList>;
export const AiTestResult = z.object({
  ok: z.boolean(),
  model: z.string().nullable(),
  reply: z.string().nullable(),
  error: z.string().nullable(),
});
export type AiTestResult = z.infer<typeof AiTestResult>;

/** Structured decisions are checked by the server before sending or changing ownership. */
export const AiDecision = z.object({
  reply: z.string().trim().min(1).max(4096),
  action: z.enum(['answer', 'ask_resolution', 'resolve', 'handoff']),
});
export type AiDecision = z.infer<typeof AiDecision>;

/** Paste-the-callback fallback for admins who cannot reach the server's localhost callback. */
export const AiCallbackBody = z.object({ url: z.string().trim().min(1).max(4096) });
export type AiCallbackBody = z.infer<typeof AiCallbackBody>;

export const AI_TRY_QUESTION_CHARACTERS = 500;
/** Try it: a test question answered from the page's current (possibly unsaved) knowledge. */
export const AiTryBody = z.object({
  question: z.string().trim().min(1).max(AI_TRY_QUESTION_CHARACTERS),
  knowledge: AiMemberBody.pick({ displayName: true, instructions: true, context: true }),
});
export type AiTryBody = z.infer<typeof AiTryBody>;
export const AiTryResult = z.object({
  ok: z.boolean(),
  reply: z.string().nullable(),
  action: AiDecision.shape.action.nullable(),
  model: z.string().nullable(),
  error: z.string().nullable(),
});
export type AiTryResult = z.infer<typeof AiTryResult>;

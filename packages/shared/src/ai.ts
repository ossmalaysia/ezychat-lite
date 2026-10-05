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

/**
 * Text limit of one Business context text item in characters (Unicode code points, so an emoji
 * counts once). Above the server's 40,000-character full-context budget, relevant parts of all
 * context items are selected per question.
 */
export const AI_CONTEXT_CHARACTERS = 100_000;
/** Name limit of a Business context item. */
export const AI_CONTEXT_NAME_CHARACTERS = 120;
/** Business context items (uploaded files plus text content) per inbox. */
export const AI_CONTEXT_ITEMS = 20;
/** Length in Unicode code points (never splits surrogate pairs, unlike `string.length`). */
export function codePointLength(text: string): number {
  let length = 0;
  for (const _ of text) length++;
  return length;
}

export const AiSettingsBody = z.object({
  displayName: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  mode: z.enum(['api', 'chatgpt']),
  model: z.string().trim().max(128),
  instructions: z.string().max(8000),
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

const contextName = z.string().trim().min(1).max(AI_CONTEXT_NAME_CHARACTERS);
const contextText = z
  .string()
  // UTF-16 bound first (cheap), then the exact code point limit.
  .max(AI_CONTEXT_CHARACTERS * 2)
  .refine((text) => text.trim().length > 0, { message: 'Add some text' })
  .refine((text) => codePointLength(text) <= AI_CONTEXT_CHARACTERS, {
    message: `Text content can contain up to ${AI_CONTEXT_CHARACTERS.toLocaleString('en')} characters`,
  });
/** Business context "Add text content": a named text item (hours, prices, policies, FAQs…). */
export const AiContextTextBody = z.object({ name: contextName, text: contextText });
export type AiContextTextBody = z.infer<typeof AiContextTextBody>;
/** Edits a text item (file items are read-only). */
export const AiContextPatchBody = z
  .object({ name: contextName.optional(), text: contextText.optional() })
  .refine((body) => body.name !== undefined || body.text !== undefined, {
    message: 'Change the name or the text',
  });
export type AiContextPatchBody = z.infer<typeof AiContextPatchBody>;

/** One Business context item: an uploaded file or text content. */
export const AiDocument = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: z.enum(['file', 'text']),
  /** Bytes of the original upload, or of the text in UTF-8. */
  size: z.number(),
  characters: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AiDocument = z.infer<typeof AiDocument>;
/** Characters of a file item's extracted text shown in its read-only preview. */
export const AI_CONTEXT_PREVIEW_CHARACTERS = 20_000;
/** An item with its text: full for text items (editable), a preview for files. */
export const AiDocumentView = AiDocument.extend({ text: z.string(), truncated: z.boolean() });
export type AiDocumentView = z.infer<typeof AiDocumentView>;
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
/**
 * Try it: a test question answered with the page's current (possibly unsaved) name and
 * instructions; the server adds the saved Business context items.
 */
export const AiTryBody = z.object({
  question: z.string().trim().min(1).max(AI_TRY_QUESTION_CHARACTERS),
  knowledge: AiMemberBody.pick({ displayName: true, instructions: true }),
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

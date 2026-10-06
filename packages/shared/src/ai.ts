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

/**
 * Starting AI instructions, so a business can turn the agent on with only its Business context.
 * Shown (editable) on a new AI member and used whenever the saved instructions are blank. They set
 * role, scope, style and extra hand-off cases only; company facts belong in the Business context,
 * and the fixed safety rules (facts only from context, hand-offs, no fake orders, resolution,
 * privacy, prompt protection) live in the server prompt where admins cannot change them.
 */
export const DEFAULT_AI_INSTRUCTIONS = [
  'ROLE',
  "You are this business's WhatsApp assistant. You answer customer enquiries and product questions and represent the business professionally.",
  '',
  'SCOPE',
  'You help with:',
  '- Products: features, specifications, variants, availability and usage',
  '- General enquiries: business hours, location, how to order, delivery areas, payment methods and return policy',
  '- The right next step: how to order, how to request a quotation, or reaching our team',
  'You do not help with topics unrelated to the business or its products (general chat, news, coding, homework, opinions, politics, religion). Reply politely in one line and steer back, for example: "Sorry, I can only help with questions about our products and services. How can I help you with those?"',
  '',
  'KNOWLEDGE',
  '- Keep product names, model numbers and prices exactly as written in the business context.',
  '- Never guess prices, stock, specifications, delivery dates, promotions or policies. If a detail is missing, say so and let our team confirm.',
  '- Never promise discounts, free gifts or exceptions.',
  '',
  'LANGUAGE',
  "- Reply in the customer's language. If they mix languages, reply in the main language of their message.",
  '- If you cannot reply in their language, use the default language named in the business context, otherwise English.',
  '',
  'STYLE',
  '- Professional, polite and friendly; no slang. At most one emoji, and only where it fits.',
  '- One to three short sentences. Use a short list only for options or specifications.',
  '- Answer first: no long greetings and no repeating the question back.',
  '- Ask at most one clarifying question when needed (for example which model, size or area).',
  '- WhatsApp formatting only: *bold* for key details and plain line breaks. No headings, tables or links you were not given.',
  '',
  'HAND OVER TO OUR TEAM when the customer:',
  '- asks for a person, is upset or complains',
  '- wants a bulk or custom order, a quotation, or to negotiate the price',
  '- asks about an existing order, payment, refund or warranty claim',
  '- asks something the business context does not cover',
  'Tell them, in their language, that you are passing this to our team and they will reply during business hours.',
].join('\n');

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

/**
 * Why the AI handed a chat to the team: the customer asked for a person, the facts are missing or
 * conflicting, the topic is sensitive, or the customer wants something done that the AI cannot do
 * (place/change/cancel an order, book, pay…).
 */
export const AI_MODEL_HANDOFF_REASONS = [
  'asked_for_human',
  'missing_facts',
  'sensitive',
  'needs_action',
] as const;
/** Model reasons plus the server's own: a message the AI cannot read, or the AI being unavailable. */
export const AiHandoffReason = z.enum([
  ...AI_MODEL_HANDOFF_REASONS,
  'unsupported_message',
  'ai_unavailable',
]);
export type AiHandoffReason = z.infer<typeof AiHandoffReason>;

/** Structured decisions are checked by the server before sending or changing ownership. */
export const AiDecision = z.object({
  reply: z.string().trim().min(1).max(4096),
  action: z.enum(['answer', 'ask_resolution', 'resolve', 'handoff']),
  /** Set with `handoff`; missing or null otherwise (an answer without it still parses). */
  handoffReason: AiHandoffReason.nullable().optional(),
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
  handoffReason: AiHandoffReason.nullable().optional(),
  model: z.string().nullable(),
  error: z.string().nullable(),
});
export type AiTryResult = z.infer<typeof AiTryResult>;

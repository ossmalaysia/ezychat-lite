import { z } from 'zod';

/**
 * AI reply suggestions (design: docs/features/ai-reply-suggestions/design.md). A teammate presses
 * Suggest reply in a direct chat and gets up to 2 drafts, or grey completion text after a full
 * word. The AI never sends.
 */

/** What the composer shows: `off` = no button, `unavailable` = disabled button, `on` = usable. */
export const ReplySuggestionsState = z.enum(['on', 'off', 'unavailable']);
export type ReplySuggestionsState = z.infer<typeof ReplySuggestionsState>;

/** `GET /api/reply-suggestions` (any signed-in user) and the admin `PUT /api/ai/reply-suggestions` answer. */
export const ReplySuggestionsStatus = z.object({
  /** The team-wide admin switch (setting `ai_reply_suggestions`). */
  enabled: z.boolean(),
  /** The shared AI connection is usable right now. */
  connected: z.boolean(),
  state: ReplySuggestionsState,
  /** The install existed before the feature, so the switch started off (Settings shows a note). */
  upgraded: z.boolean().default(false),
});
export type ReplySuggestionsStatus = z.infer<typeof ReplySuggestionsStatus>;

/** `PUT /api/ai/reply-suggestions` (admins only). */
export const ReplySuggestionsBody = z.strictObject({ enabled: z.boolean() });
export type ReplySuggestionsBody = z.infer<typeof ReplySuggestionsBody>;

export const REPLY_SUGGESTION_LABEL_CHARACTERS = 40;
export const REPLY_TEXT_CHARACTERS = 4096;
export const REPLY_COMPLETION_CHARACTERS = 120;

/** One chip: a short label; a tap puts the full text in the composer. */
export const ReplySuggestion = z.object({
  label: z.string().min(1).max(REPLY_SUGGESTION_LABEL_CHARACTERS),
  text: z.string().min(1).max(REPLY_TEXT_CHARACTERS),
});
export type ReplySuggestion = z.infer<typeof ReplySuggestion>;

/** `POST /api/chats/:jid/ai/suggestions`. */
export const ReplySuggestionsResult = z.object({
  suggestions: z.array(ReplySuggestion).max(2),
  /** The business context has no answer for the customer's request. */
  noAnswer: z.boolean(),
  /** A business hand-off rule matches: a note instead of drafts. */
  handoffRule: z.string().max(200).nullable(),
});
export type ReplySuggestionsResult = z.infer<typeof ReplySuggestionsResult>;

/** `POST /api/chats/:jid/ai/complete`: the composer text so far. */
export const ReplyCompleteBody = z.strictObject({
  text: z.string().min(1).max(REPLY_TEXT_CHARACTERS),
});
export type ReplyCompleteBody = z.infer<typeof ReplyCompleteBody>;

export const ReplyCompleteResult = z.object({
  completion: z.string().max(REPLY_COMPLETION_CHARACTERS).nullable(),
});
export type ReplyCompleteResult = z.infer<typeof ReplyCompleteResult>;

/**
 * A full word, then one or more spaces or punctuation marks ("Hi Nurul, " counts). Chinese has no
 * spaces: its punctuation is the boundary.
 */
export const REPLY_COMPLETION_READY = /[\p{L}\p{N}][\s,.!?;:，。？！、]+$/u;

/** Completion runs only after at least one full word, never for a quick-reply command (`/…`). */
export function completionReady(text: string): boolean {
  return REPLY_COMPLETION_READY.test(text) && !text.trimStart().startsWith('/');
}

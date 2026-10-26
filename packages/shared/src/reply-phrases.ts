import { z } from 'zod';

/**
 * The team's phrase list (design: docs/features/ai-phrase-dictionary/design.md). The AI builds it in
 * the background from the business context, the AI instructions and the team's sent replies; the
 * composer matches it locally on every key, so a phrase shows as grey text at once.
 */

/** Each language has its own phrases, written natively (never translations). */
export const ReplyPhraseLanguage = z.enum(['en', 'ms', 'zh']);
export type ReplyPhraseLanguage = z.infer<typeof ReplyPhraseLanguage>;

/** `context` / `team` = built by the AI from that source; `admin` = written or edited by an admin. */
export const ReplyPhraseSource = z.enum(['context', 'team', 'admin']);
export type ReplyPhraseSource = z.infer<typeof ReplyPhraseSource>;

export const REPLY_PHRASE_CHARACTERS = 200;
export const REPLY_PHRASE_MIN_CHARACTERS = 3;
/** Phrases kept per agent and language (the most used and newest win). */
export const REPLY_PHRASES_PER_LANGUAGE = 300;

export const ReplyPhrase = z.object({
  id: z.number().int().positive(),
  text: z.string().min(1).max(REPLY_PHRASE_CHARACTERS),
  language: ReplyPhraseLanguage,
  source: ReplyPhraseSource,
  /** Times a teammate accepted it (Tab / Accept) minus dismissals (Esc), never below 0. */
  uses: z.number().int().nonnegative(),
  /** Has a number (price, hours): checked against the business context on every build. */
  fact: z.boolean(),
});
export type ReplyPhrase = z.infer<typeof ReplyPhrase>;

/** What every composer loads: `GET /api/chats/:jid/ai/phrases` (empty while suggestions are off). */
export const ReplyPhraseListItem = ReplyPhrase.pick({ id: true, text: true, language: true });
export type ReplyPhraseListItem = z.infer<typeof ReplyPhraseListItem>;
export const ReplyPhraseList = z.object({ phrases: z.array(ReplyPhraseListItem) });
export type ReplyPhraseList = z.infer<typeof ReplyPhraseList>;

/** `POST /api/chats/:jid/ai/phrases/:id/feedback`: Tab / Accept (true) or Esc (false). */
export const ReplyPhraseFeedbackBody = z.strictObject({ accepted: z.boolean() });
export type ReplyPhraseFeedbackBody = z.infer<typeof ReplyPhraseFeedbackBody>;

/** Why the last build ran (shown as "Updated … after …"). */
export const ReplyPhraseTrigger = z.enum(['start', 'context', 'replies', 'manual', 'weekly']);
export type ReplyPhraseTrigger = z.infer<typeof ReplyPhraseTrigger>;

/** `ready` = a list exists; `empty` = never built; `building` = a build runs; `error` = the last build failed. */
export const ReplyPhraseState = z.enum(['ready', 'empty', 'building', 'error']);
export type ReplyPhraseState = z.infer<typeof ReplyPhraseState>;

export const ReplyPhraseStatus = z.object({
  state: ReplyPhraseState,
  count: z.number().int().nonnegative(),
  languages: z.array(z.object({ language: ReplyPhraseLanguage, count: z.number().int() })),
  updatedAt: z.number().nullable(),
  trigger: ReplyPhraseTrigger.nullable(),
  /** Team replies since the last build, and how many start the next one. */
  newReplies: z.number().int().nonnegative(),
  nextAfterReplies: z.number().int().positive(),
  aiCallsToday: z.number().int().nonnegative(),
  aiCallsLimit: z.number().int().positive(),
});
export type ReplyPhraseStatus = z.infer<typeof ReplyPhraseStatus>;

/** Admin `GET /api/ai/phrases?agentId=`: the status and every phrase, most used first. */
export const ReplyPhrasesAdmin = z.object({
  agentId: z.number().int().positive().nullable(),
  status: ReplyPhraseStatus,
  phrases: z.array(ReplyPhrase),
});
export type ReplyPhrasesAdmin = z.infer<typeof ReplyPhrasesAdmin>;

/** Admin add / edit (`POST /api/ai/phrases`, `PUT /api/ai/phrases/:id`). */
export const ReplyPhraseBody = z.strictObject({
  text: z.string().trim().min(REPLY_PHRASE_MIN_CHARACTERS).max(REPLY_PHRASE_CHARACTERS),
  language: ReplyPhraseLanguage,
  /** Add only; omitted = the agent of inbox 1. */
  agentId: z.number().int().positive().optional(),
});
export type ReplyPhraseBody = z.infer<typeof ReplyPhraseBody>;

/** Admin `POST /api/ai/phrases/rebuild`. */
export const ReplyPhraseRebuildBody = z.strictObject({
  agentId: z.number().int().positive().optional(),
});
export type ReplyPhraseRebuildBody = z.infer<typeof ReplyPhraseRebuildBody>;

/**
 * Which model answers Suggest reply, the grey text and the phrase build (setting
 * `ai_reply_suggestions_model`): `fast` = the connection's fast model, `agent` = the saved model of the
 * AI connection, or one model id of the connection.
 */
export const ReplySuggestModel = z.string().trim().min(1).max(64);
export const ReplySuggestModelInfo = z.object({
  model: ReplySuggestModel,
  fastModel: z.string(),
  agentModel: z.string(),
  /** The models of this connection an admin may pick. */
  models: z.array(z.string()),
  /** The model a call uses now. */
  resolved: z.string(),
});
export type ReplySuggestModelInfo = z.infer<typeof ReplySuggestModelInfo>;

// Each Chinese character counts as one word (Han first: it is also \p{L}).
const WORD = /\p{Script=Han}|[\p{L}\p{N}#.]+/gu;
const words = (text: string) => [...text.toLowerCase().matchAll(WORD)].map((m) => m[0]);

/**
 * Instant grey text from the phrase list: the last 2–4 typed words (the last one may be half typed;
 * each Chinese character is a word) must appear in a phrase, and the rest of that phrase is the grey
 * text (at most 120 characters). The list is ordered most used first, so the first match wins.
 * Never for a quick-reply command (`/…`).
 */
export function matchPhrase(
  phrases: readonly Pick<ReplyPhraseListItem, 'id' | 'text' | 'language'>[],
  text: string,
): { id: number; rest: string } | null {
  if (text.trimStart().startsWith('/')) return null;
  const typed = words(text);
  if (typed.length < 2) return null;
  const endsWithSpace = /\s$/u.test(text);
  for (const take of [4, 3, 2]) {
    if (typed.length < take) continue;
    const tail = typed.slice(-take);
    for (const phrase of phrases) {
      const joined = phrase.language === 'zh' ? tail.join('') : tail.join(' ');
      const at = phrase.text.toLowerCase().indexOf(joined);
      if (at < 0) continue;
      // A Latin match must start at a word start ("for" must not match inside "before").
      if (phrase.language !== 'zh' && at > 0 && /[\p{L}\p{N}]/u.test(phrase.text[at - 1]!))
        continue;
      const rest = phrase.text.slice(at + joined.length);
      const next = endsWithSpace ? rest.replace(/^\s+/u, '') : rest;
      if (next.trim().length > 1) return { id: phrase.id, rest: next.slice(0, 120) };
    }
  }
  return null;
}

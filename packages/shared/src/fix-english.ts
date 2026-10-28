import { z } from 'zod';

/**
 * Fix English (design: docs/features/grammar-fix/design.md). While a teammate types an English
 * reply, the composer marks spelling at once (a dictionary in the browser, no AI) and grammar after
 * a pause (one AI call). One tap fixes a word; nothing changes or is sent without the teammate.
 */

/**
 * `GET /api/fix-english` (any signed-in user) and the admin `PUT /api/ai/fix-english` answer.
 * Spelling needs no AI; grammar needs the shared AI connection (`none` = no saved connection,
 * `unavailable` = a saved one that does not work now).
 */
export const FixEnglishStatus = z.object({
  /** The team-wide admin switch (setting `fix_english`). */
  enabled: z.boolean(),
  /** The shared AI connection is usable right now. */
  connected: z.boolean(),
  spelling: z.enum(['on', 'off']),
  grammar: z.enum(['on', 'off', 'none', 'unavailable']),
  /** The install existed before the feature, so the switch started off (Settings shows a note). */
  upgraded: z.boolean().default(false),
});
export type FixEnglishStatus = z.infer<typeof FixEnglishStatus>;

/** `PUT /api/ai/fix-english` (admins only). */
export const FixEnglishBody = z.strictObject({ enabled: z.boolean() });
export type FixEnglishBody = z.infer<typeof FixEnglishBody>;

export const FIX_ENGLISH_TEXT_CHARACTERS = 4096;
/** The grammar check runs after this pause in typing, so typing itself makes no AI call. */
export const FIX_GRAMMAR_PAUSE_MS = 700;

/** `POST /api/chats/:jid/ai/fix-grammar`: the whole draft. */
export const FixGrammarBody = z.strictObject({
  text: z.string().min(1).max(FIX_ENGLISH_TEXT_CHARACTERS),
});
export type FixGrammarBody = z.infer<typeof FixGrammarBody>;

/** One grammar mistake: replace `text.slice(start, end)` (= `original`) with `replacement`. */
export const GrammarIssue = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  original: z.string().max(200),
  replacement: z.string().max(200),
});
export type GrammarIssue = z.infer<typeof GrammarIssue>;

export const FixGrammarResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checked'), issues: z.array(GrammarIssue).max(40) }),
  /** Malay, Chinese or mixed text, or too short: nothing is checked. */
  z.object({ status: z.literal('skipped'), reason: z.enum(['not_english', 'too_short']) }),
]);
export type FixGrammarResult = z.infer<typeof FixGrammarResult>;

export const TEAM_WORD_CHARACTERS = 40;
export const TEAM_WORDS_MAX = 500;

/** Letters (any script), spaces, apostrophes and hyphens; no digits or links. */
const TEAM_WORD = /^[\p{L}\p{M}' -]+$/u;

/** `POST /api/fix-english/words` (any signed-in user). */
export const TeamWordBody = z.strictObject({
  word: z
    .string()
    .trim()
    .min(1)
    .max(TEAM_WORD_CHARACTERS)
    .transform((word) => word.replace(/\s+/g, ' '))
    .refine((word) => TEAM_WORD.test(word), { message: 'Use letters only (no numbers or links)' }),
});
export type TeamWordBody = z.infer<typeof TeamWordBody>;

export const TeamWord = z.object({
  word: z.string(),
  /** Display name of the teammate who added it (null: that user no longer exists). */
  addedBy: z.string().nullable(),
  createdAt: z.number(),
});
export type TeamWord = z.infer<typeof TeamWord>;

/** `GET /api/fix-english/words` and the answer of every change. */
export const TeamWordsResult = z.object({
  words: z.array(TeamWord),
  /**
   * The words of every agent's Business context (not Internal items), lower case: never marked.
   * Settings shows the ones the dictionary does not know.
   */
  businessWords: z.array(z.string()).default([]),
});
export type TeamWordsResult = z.infer<typeof TeamWordsResult>;

const MALAY_WORDS = new Set(
  'saya awak boleh terima kasih tak nak sudah belum ada dengan untuk kami anda encik puan esok sini sana tunggu nanti hantar berapa sebab dulu'.split(
    ' ',
  ),
);

/**
 * Malay, Chinese or Tamil (or English mixed with them) is not checked: Fix English is for English
 * only. Two or more common Malay words count as Malay; one ("ok boleh") does not.
 */
export function notEnglish(text: string): boolean {
  if (/[\p{Script=Han}\p{Script=Tamil}\p{Script=Arabic}]/u.test(text)) return true;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.filter((word) => MALAY_WORDS.has(word)).length >= 2;
}

/** Every single word of the team list and the Business context words, lower case. */
export function acceptedWords(
  words: readonly { word: string }[],
  businessWords: readonly string[],
): Set<string> {
  return new Set([
    ...words.flatMap((w) => w.word.toLowerCase().split(/[\s-]+/)),
    ...businessWords.map((w) => w.toLowerCase()),
  ]);
}

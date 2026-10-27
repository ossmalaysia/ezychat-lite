import {
  REPLY_COMPLETION_CHARACTERS,
  REPLY_SUGGESTION_LABEL_CHARACTERS,
  REPLY_TEXT_CHARACTERS,
  type ReplySuggestionsResult,
} from '@ezychat/shared';
import type { CompletionOutput, DraftOutput } from './draft-prompt.js';
import { AI_LEAK_MIN_RUN, findLeak } from './leak-check.js';

export type { CompletionOutput, DraftOutput } from './draft-prompt.js';

const NUMBER = /\d+(?:[.,:]\d+)*/g;
const cents = (token: string) => Math.round(Number(token.replace(/,/g, '')) * 100);
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const valuesOf = (text: string) =>
  (text.match(NUMBER) ?? []).map(cents).filter((v) => Number.isFinite(v));

/**
 * Numbers in `text` (prices, times, order numbers) that `sources` does not contain, compared by
 * value ("RM 1,500" = "RM1500", "RM15" = "RM15.00"). A sum or a product of two numbers from
 * `prices` (the business context) counts as grounded: 2 × RM12 = RM24, RM12 + RM3.50 = RM15.50.
 */
export function ungroundedNumbers(text: string, sources: string, prices = sources): string[] {
  const known = new Set(valuesOf(sources));
  const listed = valuesOf(prices);
  const derived = new Set<number>();
  for (const a of listed)
    for (const b of listed) {
      derived.add(a + b);
      derived.add(Math.round((a * b) / 100));
    }
  return (text.match(NUMBER) ?? []).filter((token) => {
    const v = cents(token);
    return !known.has(v) && !derived.has(v);
  });
}

/** Internal items shorter than the 40-character leak run, but long enough to mean something. */
const SHORT_INTERNAL_MIN = 8;

/** True when `text` copies an Internal item: a 40-character run, or a whole short item. */
export function copiesInternal(text: string, internalTexts: readonly string[]): boolean {
  if (findLeak(text, internalTexts)) return true;
  const haystack = normalise(text);
  return internalTexts.some((raw) => {
    const item = normalise(raw);
    return (
      item.length >= SHORT_INTERNAL_MIN && item.length < AI_LEAK_MIN_RUN && haystack.includes(item)
    );
  });
}

/** At most 40 characters, cut at a word with "…" when longer. */
function shortLabel(label: string): string {
  const clean = label.replace(/\s+/g, ' ').trim();
  if (clean.length <= REPLY_SUGGESTION_LABEL_CHARACTERS) return clean;
  const room = clean.slice(0, REPLY_SUGGESTION_LABEL_CHARACTERS - 1);
  const cut = room.lastIndexOf(' ');
  return `${(cut > 0 ? room.slice(0, cut) : room).trimEnd()}…`;
}

const safe = (text: string, sources: string, internalTexts: readonly string[], prices: string) =>
  ungroundedNumbers(text, sources, prices).length === 0 && !copiesInternal(text, internalTexts);

/**
 * The chips a teammate may see: grounded drafts whose numbers all come from the sources and that
 * copy no Internal item; a near-copy of the first is dropped. A matching hand-off rule shows a
 * note instead of drafts; nothing left means "No answer in the business context".
 */
export function acceptDrafts(
  output: DraftOutput,
  sources: string,
  internalTexts: readonly string[],
  /** The business context: sums and products of its numbers count as grounded. */
  prices = sources,
): ReplySuggestionsResult {
  const handoffRule = output.handoffRule?.trim().slice(0, 200) || null;
  if (handoffRule) return { suggestions: [], noAnswer: false, handoffRule };
  const kept: ReplySuggestionsResult['suggestions'] = [];
  for (const draft of output.suggestions) {
    const text = draft.text.trim();
    if (!draft.grounded || !text || text.length > REPLY_TEXT_CHARACTERS) continue;
    if (!safe(text, sources, internalTexts, prices)) continue;
    if (kept.some((other) => normalise(other.text) === normalise(text))) continue;
    kept.push({ label: shortLabel(draft.label) || shortLabel(text), text });
  }
  return { suggestions: kept.slice(0, 2), noAnswer: kept.length === 0, handoffRule: null };
}

/** The grey text: the rest of the current sentence, grounded, no new numbers, no leak, ≤ 120 characters. */
export function acceptCompletion(
  output: CompletionOutput,
  typed: string,
  sources: string,
  internalTexts: readonly string[],
  prices = sources,
): string | null {
  return checkCompletion(output, typed, sources, internalTexts, prices).completion;
}

// Where a typed word may start: after a space or punctuation, or at any Chinese character.
const WORD_START = /(?<=[\s,.!?;:，。？！、])\S|\p{Script=Han}/gu;

/**
 * Characters of `text` (from its start) that spell `prefix`, ignoring case and treating any run
 * of spaces as one space; -1 when `text` does not start with it.
 */
function spelledLength(text: string, prefix: string): number {
  const isSpace = (c: string | undefined) => c !== undefined && /\s/u.test(c);
  // The prefix as words; between two words `text` needs at least one space.
  const words = prefix.split(/\s+/u).filter(Boolean);
  let i = 0;
  for (const [n, word] of words.entries()) {
    if (n > 0) {
      if (!isSpace(text[i])) return -1;
      while (isSpace(text[i])) i++;
    }
    if (text.slice(i, i + word.length).toLowerCase() !== word.toLowerCase()) return -1;
    i += word.length;
  }
  return words.length ? i : -1;
}

/**
 * The grey text must continue the typed text, never repeat it: models often send the whole
 * sentence ("hi what would you like to know?" for "hi what"). Cuts the longest end of the typed
 * text that starts at a word start and that the completion starts with ("Hi Nu" + "Nurul, how…" →
 * "rul, how…"), so the space after a finished word stays. After a typed space, no leading space.
 */
export function continuationOf(typed: string, completion: string): string {
  const body = typed.trimEnd();
  const head = completion.trimStart();
  const starts = [0, ...[...body.matchAll(WORD_START)].map((m) => m.index)];
  let rest = completion;
  for (const at of starts) {
    const used = spelledLength(head, body.slice(at));
    if (used > 0) {
      rest = head.slice(used);
      break;
    }
  }
  return body.length < typed.length ? rest.trimStart() : rest;
}

/** Why a completion shows no grey text (logged as a name only, never the text). */
export type CompletionDrop = 'empty' | 'ungrounded' | 'too_long' | 'number' | 'internal';

/** `acceptCompletion` plus the reason a dropped completion was dropped. */
export function checkCompletion(
  output: CompletionOutput,
  typed: string,
  sources: string,
  internalTexts: readonly string[],
  prices = sources,
): { completion: string | null; dropped: CompletionDrop | null } {
  const drop = (dropped: CompletionDrop) => ({ completion: null, dropped });
  if (!output.completion?.trim()) return drop('empty');
  if (!output.grounded) return drop('ungrounded');
  // Only what comes after the typed text, however much of it the model repeated.
  const continued = continuationOf(typed, output.completion);
  if (!continued.trim()) return drop('empty');
  const end = continued.search(/[.!?。？](\s|$)/u);
  const completion = end >= 0 ? continued.slice(0, end + 1) : continued;
  if (completion.length > REPLY_COMPLETION_CHARACTERS) return drop('too_long');
  if (ungroundedNumbers(completion, sources, prices).length > 0) return drop('number');
  // The leak check sees the whole sentence: a run may start in the typed text.
  if (
    copiesInternal(completion, internalTexts) ||
    copiesInternal(typed + completion, internalTexts)
  )
    return drop('internal');
  return { completion, dropped: null };
}

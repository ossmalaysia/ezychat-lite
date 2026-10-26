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
  const end = output.completion.search(/[.!?。？](\s|$)/u);
  const completion = end >= 0 ? output.completion.slice(0, end + 1) : output.completion;
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

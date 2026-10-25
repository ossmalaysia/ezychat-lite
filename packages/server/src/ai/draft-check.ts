import {
  REPLY_COMPLETION_CHARACTERS,
  REPLY_SUGGESTION_LABEL_CHARACTERS,
  type ReplySuggestionsResult,
} from '@ezychat/shared';
import type { CompletionOutput, DraftOutput } from './draft-prompt.js';
import { findLeak } from './leak-check.js';

export type { CompletionOutput, DraftOutput } from './draft-prompt.js';

const NUMBER = /\d+(?:[.,:]\d+)*/g;
const value = (token: string) => Number(token.replace(/,/g, ''));
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Numbers in `text` (prices, times, order numbers) that `sources` does not contain. A sum or a
 * product of two source numbers counts as grounded (2 × RM12 = RM24, RM12 + RM3.50 = RM15.50).
 */
export function ungroundedNumbers(text: string, sources: string): string[] {
  const known = new Set(sources.match(NUMBER) ?? []);
  const values = [...known].map(value).filter(Number.isFinite);
  const derived = new Set<number>();
  for (const a of values)
    for (const b of values) {
      derived.add(Math.round((a + b) * 100) / 100);
      derived.add(Math.round(a * b * 100) / 100);
    }
  return (text.match(NUMBER) ?? []).filter(
    (token) => !known.has(token) && !derived.has(Math.round(value(token) * 100) / 100),
  );
}

/** At most 40 characters, cut at a word with "…" when longer. */
function shortLabel(label: string): string {
  const clean = label.replace(/\s+/g, ' ').trim();
  if (clean.length <= REPLY_SUGGESTION_LABEL_CHARACTERS) return clean;
  const room = clean.slice(0, REPLY_SUGGESTION_LABEL_CHARACTERS - 1);
  const cut = room.lastIndexOf(' ');
  return `${(cut > 0 ? room.slice(0, cut) : room).trimEnd()}…`;
}

const safe = (text: string, sources: string, internalTexts: readonly string[]) =>
  ungroundedNumbers(text, sources).length === 0 && !findLeak(text, internalTexts);

/**
 * The chips a teammate may see: grounded drafts whose numbers all come from the sources and that
 * copy no Internal item; a near-copy of the first is dropped. A matching hand-off rule shows a
 * note instead of drafts; nothing left means "No answer in the business context".
 */
export function acceptDrafts(
  output: DraftOutput,
  sources: string,
  internalTexts: readonly string[],
): ReplySuggestionsResult {
  const handoffRule = output.handoffRule?.trim().slice(0, 200) || null;
  if (handoffRule) return { suggestions: [], noAnswer: false, handoffRule };
  const kept: ReplySuggestionsResult['suggestions'] = [];
  for (const draft of output.suggestions) {
    const text = draft.text.trim();
    if (!draft.grounded || !text || !safe(text, sources, internalTexts)) continue;
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
): string | null {
  if (!output.grounded || !output.completion?.trim()) return null;
  const end = output.completion.search(/[.!?。？](\s|$)/u);
  const completion = end >= 0 ? output.completion.slice(0, end + 1) : output.completion;
  if (completion.length > REPLY_COMPLETION_CHARACTERS) return null;
  // The leak check sees the whole sentence: a run may start in the typed text.
  if (!safe(completion, sources, internalTexts) || findLeak(typed + completion, internalTexts))
    return null;
  return completion;
}

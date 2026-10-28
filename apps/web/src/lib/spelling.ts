import { notEnglish } from '@ezychat/shared';

/**
 * Fix English spelling (docs/features/grammar-fix/design.md): every word of the draft is checked in
 * the browser against the British English Hunspell dictionary (`nspell`), with no AI and no server
 * call. This file is the pure part (which words to mark, which fix is safe); `dictionary.ts` loads
 * the dictionary and `useSpelling` runs it.
 */

/** What the composer needs from the dictionary (`nspell` has both). */
export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

/** One marked word. `replacement` is the safe fix for Fix all (null: choose in the card, or add). */
export interface SpellingIssue {
  start: number;
  end: number;
  original: string;
  /** Up to 3 suggestions, best first; empty = not in the dictionary (offer Add to team words). */
  suggestions: string[];
  replacement: string | null;
}

/**
 * Chat short forms the dictionary has no good fix for. "i" alone is always "I"; short forms that
 * are normal in Malaysian chat (ok, lah, ya, tq) are in LOCAL_WORDS and never marked.
 */
export const SHORT_FORMS: Readonly<Record<string, string>> = {
  i: 'I',
  pls: 'please',
  plz: 'please',
  u: 'you',
  ur: 'your',
  thx: 'thanks',
  msg: 'message',
  abt: 'about',
  bcos: 'because',
  bcoz: 'because',
  coz: 'because',
  tmr: 'tomorrow',
  tmrw: 'tomorrow',
  dont: "don't",
  cant: "can't",
  wont: "won't",
  didnt: "didn't",
  doesnt: "doesn't",
  isnt: "isn't",
  im: "I'm",
};

/**
 * Words normal in Malaysian business chat that an English dictionary does not know: particles,
 * food, places, payment and delivery services. Never marked. The team adds its own (team words),
 * and every word of the Business context counts too.
 */
export const LOCAL_WORDS: ReadonlySet<string> = new Set(
  (
    'ok okay lah la leh lor meh mah wor ya yah yeah hor ah eh alamak aiyo aiya walao tq ty noted ' +
    'boleh tak nak makan tapau dabao kopi teh tarik nasi lemak goreng mee mamak roti canai kuih ' +
    'cendol durian rendang satay laksa nyonya kopitiam teh-o pax ' +
    'malaysia malaysian penang kl kuala lumpur selangor johor bahru melaka malacca perak ipoh kedah ' +
    'kelantan terengganu pahang sabah sarawak putrajaya klang petaling jaya puchong cyberjaya ' +
    'subang shah alam bangsar cheras ampang butterworth seberang perai bayan lepas jalan lorong taman ' +
    'whatsapp shopee lazada grab grabfood foodpanda lalamove jnt poslaju ninjavan duitnow fpx ' +
    'touch n go tng maybank cimb rhb ringgit sdn bhd ezychat'
  ).split(/\s+/),
);

const isCapital = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * US spellings count as correct (the team writes both): "color" (colour), "organize" (organise),
 * "center" (centre), "canceled" (cancelled), "catalog" (catalogue).
 */
function usSpelling(word: string, speller: Speller): boolean {
  const lower = word.toLowerCase();
  const variants = [
    lower.replace(/or(s?)$/, 'our$1'),
    lower.replace(/iz(e|es|ed|ing|ation|ations)$/, 'is$1'),
    lower.replace(/yz(e|es|ed|ing)$/, 'ys$1'),
    lower.replace(/er(s?)$/, 're$1'),
    lower.replace(/([aeiou])l(ed|ing|er)$/, '$1ll$2'),
    lower.replace(/og(s?)$/, 'ogue$1'),
  ];
  return variants.some((v) => v !== lower && speller.correct(v));
}

/** Damerau–Levenshtein distance (with one transposition), for "is this fix safe". */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => {
      if (i === 0) return j;
      return j === 0 ? i : 0;
    }),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/**
 * Frequent words in business chat: when two fixes are equally close, the common one wins ("wich"
 * → which, not rich; "thnks" → thanks, not tanks).
 */
const COMMON_WORDS: ReadonlySet<string> = new Set(
  (
    'the and that this with which what when where their there they them then than thanks thank ' +
    'please would could should about because before after again also already available address ' +
    'order orders ordered delivery delivered deliver price prices payment paid pay receipt invoice ' +
    'quotation quote booking booked confirm confirmed check checked cancel cancelled refund stock ' +
    'today tomorrow morning afternoon evening tonight week month time minutes hour hours ready ' +
    'send sent receive received reply message call contact customer service team shop store ' +
    'pickup collect location table people menu item items size colour quantity total free extra ' +
    'sorry welcome noted sure great good well will your you have has been being just only still'
  ).split(/\s+/),
);

/** The word with two neighbouring letters swapped: the most common typing slip ("teh"). */
function swaps(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length - 1; i++)
    out.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  return out;
}

interface Ranked {
  word: string;
  swap: boolean;
  distance: number;
  common: boolean;
}

function rank(word: string, candidates: readonly string[], speller: Speller | null): Ranked[] {
  const lower = word.toLowerCase();
  const swapped = speller ? swaps(lower).filter((w) => speller.correct(w)) : [];
  const seen = new Set<string>();
  return [...swapped, ...candidates]
    .filter((w) => {
      const key = w.toLowerCase();
      if (key === lower || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((w, index) => ({
      word: w,
      index,
      swap: swapped.includes(w.toLowerCase()),
      distance: editDistance(lower, w.toLowerCase()),
      common: COMMON_WORDS.has(w.toLowerCase()),
    }))
    .sort(
      (x, y) =>
        Number(y.swap) - Number(x.swap) ||
        x.distance - y.distance ||
        Number(y.common) - Number(x.common) ||
        x.index - y.index,
    );
}

/**
 * The dictionary's suggestions re-ordered for typing slips: swapped letters first, then the
 * closest, then the common word, then the dictionary's own order.
 */
export function rankSuggestions(
  word: string,
  suggestions: readonly string[],
  speller: Speller | null = null,
): string[] {
  return rank(word, suggestions, speller).map((r) => r.word);
}

/**
 * The fix Fix all may apply without asking: the only suggestion, or a first one that is clearly
 * better than the second (a swap of two letters against none, closer by an edit, or a common word
 * against a rare one). Anything less sure is left for the teammate to choose in the card.
 */
export function safeFix(word: string, ranked: readonly string[]): string | null {
  const [first, second] = rank(word, ranked, null);
  if (!first) return null;
  if (first.distance > 2) return null;
  if (!second) return first.word;
  const lower = word.toLowerCase();
  const firstSwap = swaps(lower).includes(first.word.toLowerCase());
  const secondSwap = swaps(lower).includes(second.word.toLowerCase());
  if (firstSwap !== secondSwap) return firstSwap ? first.word : null;
  if (first.distance !== second.distance)
    return first.distance < second.distance ? first.word : null;
  return first.common && !second.common ? first.word : null;
}

/** Keeps the teammate's capital letter, and a capital at the start of a sentence. */
export function matchCase(original: string, fix: string, sentenceStart: boolean): string {
  if (fix === 'I' || fix.startsWith("I'")) return fix;
  return isCapital(original[0] ?? '') || sentenceStart ? capitalize(fix) : fix;
}

/** A word the checker found: where, and whether a capital is needed because a sentence starts. */
export interface MarkedWord {
  start: number;
  end: number;
  /** The word exactly as typed (`text.slice(start, end)`). */
  word: string;
  sentenceStart: boolean;
  /** A short form with its fix ("pls" → "please"); otherwise suggestions come from the dictionary. */
  shortForm: string | null;
}

/** Links, email addresses, @mentions and #tags (whole space-separated tokens): never checked. */
export function skippedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(/\S+/gu)) {
    const token = m[0].toLowerCase();
    if (/^(?:https?:\/\/|www\.|[@#])/u.test(token) || token.includes('@'))
      spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/** After a sentence end and a space, after a line break, or at the very start. */
function atSentenceStart(before: string): boolean {
  const trimmed = before.trimEnd();
  if (trimmed === '') return true;
  const gap = before.slice(trimmed.length);
  return gap.includes('\n') || (gap !== '' && /[.!?]$/u.test(trimmed));
}

/**
 * The words to mark, at once on every key (`correct` only; suggestions are slower and come later).
 * Not marked: the word still being typed, a word in a link/email/mention or next to a digit, an
 * all-capitals word (RM, KLCC), a capitalised word inside a sentence (a name), and the accepted
 * words (team words, Business context, the chat's name, LOCAL_WORDS).
 */
export function findMisspelled(
  text: string,
  speller: Speller,
  accepted: ReadonlySet<string>,
): MarkedWord[] {
  if (!text.trim() || notEnglish(text)) return [];
  const skipped = skippedSpans(text);
  const typing = /[\p{L}'’]$/u.test(text);
  const marked: MarkedWord[] = [];
  for (const m of text.matchAll(/\p{L}[\p{L}\p{M}'’]*/gu)) {
    let raw = m[0];
    while (raw.endsWith("'") || raw.endsWith('’')) raw = raw.slice(0, -1);
    const start = m.index;
    const end = start + raw.length;
    if (typing && start + m[0].length === text.length) continue;
    if (skipped.some(([from, to]) => start < to && end > from)) continue;
    if (/\p{N}/u.test(text.slice(Math.max(0, start - 1), end + 1))) continue;
    const word = raw.replaceAll('’', "'");
    const lower = word.toLowerCase();
    if (accepted.has(lower) || LOCAL_WORDS.has(lower)) continue;
    const sentenceStart = atSentenceStart(text.slice(0, start));
    const shortForm = SHORT_FORMS[lower];
    if (shortForm !== undefined) {
      // "I" and "I'm" written correctly are not short forms.
      if (word !== shortForm) marked.push({ start, end, word: raw, sentenceStart, shortForm });
      continue;
    }
    if (word.length < 2 || word === word.toUpperCase()) continue;
    if (isCapital(word[0]!) && !sentenceStart) continue;
    if (speller.correct(word) || speller.correct(lower) || usSpelling(word, speller)) continue;
    marked.push({ start, end, word: raw, sentenceStart, shortForm: null });
  }
  return marked;
}

/** A marked word with its suggestions (from `SHORT_FORMS` or the dictionary). */
export function toIssue(mark: MarkedWord, suggestions: readonly string[]): SpellingIssue {
  const list = (mark.shortForm ? [mark.shortForm] : [...suggestions])
    .slice(0, 3)
    .map((s) => matchCase(mark.word, s, mark.sentenceStart));
  return {
    start: mark.start,
    end: mark.end,
    original: mark.word,
    suggestions: list,
    replacement: mark.shortForm ? list[0]! : safeFix(mark.word, list),
  };
}

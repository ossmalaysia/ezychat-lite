import {
  REPLY_PHRASE_CHARACTERS,
  REPLY_PHRASE_MIN_CHARACTERS,
  type ReplyPhraseLanguage,
} from '@ezychat/shared';
import { copiesInternal, ungroundedNumbers } from '../draft-check.js';
import type { NewPhrase, StoredPhrase } from './repo.js';

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Seven or more digits, also with spaces, dashes or a leading + (phone numbers, account numbers).
const LONG_NUMBER = /\+?\d[\d\s-]{5,}\d/g;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A team reply as the build may read it: emails, long numbers and the names of the chats' people
 * replaced, so the AI learns the team's wording, never a customer's details.
 */
export function cleanTeamReply(text: string, names: readonly string[]): string {
  let out = text.replace(EMAIL, '[email]').replace(LONG_NUMBER, '[number]');
  for (const name of names) {
    if (name.trim().length < 3) continue;
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escape(name.trim())}(?![\\p{L}\\p{N}])`, 'giu'),
      '[name]',
    );
  }
  return out;
}

export const normalisePhrase = (text: string) =>
  text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export interface PhraseCandidate {
  text: string;
  language: ReplyPhraseLanguage;
  source: 'context' | 'team';
}

export interface PhraseSources {
  /** The business context the build was shown: facts in a phrase must come from it. */
  business: string;
  internalTexts: readonly string[];
  /** People's names from the chats the team replies came from. */
  names: readonly string[];
}

/** Why a candidate was dropped (counted in the build log, never the text). */
export type PhraseDrop =
  'length' | 'command' | 'placeholder' | 'number' | 'internal' | 'name' | 'duplicate';

/**
 * The AI's candidates that may become phrases: 3–200 characters, no quick-reply command, no
 * placeholder left over from the cleaning, every number in the business context, no Internal
 * item, no customer name, no duplicate (spacing and case ignored).
 */
export function acceptPhrases(
  candidates: readonly PhraseCandidate[],
  sources: PhraseSources,
): { accepted: NewPhrase[]; dropped: Partial<Record<PhraseDrop, number>> } {
  const accepted: NewPhrase[] = [];
  const dropped: Partial<Record<PhraseDrop, number>> = {};
  const seen = new Set<string>();
  const drop = (why: PhraseDrop) => (dropped[why] = (dropped[why] ?? 0) + 1);
  const names = sources.names
    .map((n) => n.trim())
    .filter((n) => n.length >= 3)
    .map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, 'iu'));
  for (const candidate of candidates) {
    const text = candidate.text.replace(/\s+/g, ' ').trim();
    if (text.length < REPLY_PHRASE_MIN_CHARACTERS || text.length > REPLY_PHRASE_CHARACTERS) {
      drop('length');
      continue;
    }
    if (text.startsWith('/')) drop('command');
    else if (/\[(?:name|email|number)\]/i.test(text)) drop('placeholder');
    else if (ungroundedNumbers(text, sources.business).length > 0) drop('number');
    else if (copiesInternal(text, sources.internalTexts)) drop('internal');
    else if (names.some((name) => name.test(text))) drop('name');
    else if (seen.has(normalisePhrase(text))) drop('duplicate');
    else {
      seen.add(normalisePhrase(text));
      accepted.push({
        text,
        language: candidate.language,
        source: candidate.source,
        fact: /\d/.test(text),
      });
    }
  }
  return { accepted, dropped };
}

/**
 * How a build changes the stored list: admin phrases always stay; an AI phrase someone used stays
 * while its numbers are still in the business context; an unused AI phrase stays only when the new
 * build made it again. New phrases already stored (spacing and case ignored) are not added twice.
 */
export function planPhraseMerge(
  stored: readonly StoredPhrase[],
  accepted: readonly NewPhrase[],
  business: string,
): { drop: number[]; add: NewPhrase[] } {
  const fresh = new Map(accepted.map((p) => [normalisePhrase(p.text), p]));
  const drop: number[] = [];
  const kept = new Set<string>();
  for (const phrase of stored) {
    const key = normalisePhrase(phrase.text);
    if (phrase.source === 'admin') {
      kept.add(key);
      continue;
    }
    const stillTrue = !phrase.fact || ungroundedNumbers(phrase.text, business).length === 0;
    if (stillTrue && (phrase.uses > 0 || fresh.has(key))) kept.add(key);
    else drop.push(phrase.id);
  }
  return { drop, add: [...fresh.entries()].filter(([key]) => !kept.has(key)).map(([, p]) => p) };
}

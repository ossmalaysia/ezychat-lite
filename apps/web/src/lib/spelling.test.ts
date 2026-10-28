import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { describe, expect, it } from 'vitest';
import {
  editDistance,
  findMisspelled,
  matchCase,
  rankSuggestions,
  safeFix,
  toIssue,
  type Speller,
} from './spelling';

const here = dirname(fileURLToPath(import.meta.url));
const vendored = join(here, '../../public/dictionaries/en-GB');
const speller: Speller = nspell({
  aff: readFileSync(join(vendored, 'index.aff')),
  dic: readFileSync(join(vendored, 'index.dic')),
});
const NONE = new Set<string>();
const words = (text: string, accepted: ReadonlySet<string> = NONE) =>
  findMisspelled(text, speller, accepted).map((m) => m.word);
const issue = (text: string) =>
  findMisspelled(text, speller, NONE).map((m) =>
    toIssue(m, rankSuggestions(m.word, speller.suggest(m.word), speller)),
  );

describe('the vendored dictionary', () => {
  it('is the dictionary-en-gb package, unchanged (update both together)', () => {
    const pkg = dirname(createRequire(import.meta.url).resolve('dictionary-en-gb'));
    const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
    for (const file of ['index.aff', 'index.dic'])
      expect(hash(join(vendored, file))).toBe(hash(join(pkg, file)));
  });
});

describe('findMisspelled', () => {
  it('marks typos and short forms, and keeps the word being typed', () => {
    expect(words('Hi, your parcel was deliverd tommorow. pls check you emial')).toEqual([
      'deliverd',
      'tommorow',
      'pls',
    ]);
    expect(words('Hi, your parcel was deliverd tommorow. pls check you emial ')).toContain('emial');
  });

  it('leaves names, Malaysian chat words, US spellings, numbers and links alone', () => {
    expect(
      words(
        'ok lah, Farah. The nasi lemak in Penang is RM12, colour or color, canceled. ' +
          'See https://kopi.my/menuu or mail aisyah@kopii.my, @Nurull #promoo KLCC 2pcs ',
      ),
    ).toEqual([]);
  });

  it('accepts team words, Business context words and the chat name', () => {
    expect(words('the kuey teow is ready ')).toEqual(['kuey', 'teow']);
    expect(words('the kuey teow is ready ', new Set(['kuey', 'teow']))).toEqual([]);
  });

  it('checks nothing in Malay or Chinese', () => {
    expect(words('Boleh, saya check dulu ya, tommorow ')).toEqual([]);
    expect(words('你好 tommorow ')).toEqual([]);
  });

  it('marks a capitalised word only at the start of a sentence', () => {
    expect(words('Tommorow is fine. Thx ')).toEqual(['Tommorow', 'Thx']);
    expect(words('see you on Tommorow ')).toEqual([]);
  });
});

describe('fixes', () => {
  it('gives a safe fix for clear typos and short forms, in the right case', () => {
    expect(issue('Tommorow pls, i will check. ')).toEqual([
      expect.objectContaining({ original: 'Tommorow', replacement: 'Tomorrow' }),
      expect.objectContaining({ original: 'pls', replacement: 'please' }),
      expect.objectContaining({ original: 'i', replacement: 'I' }),
    ]);
    expect(issue('pls call. ')[0]).toMatchObject({ replacement: 'Please' });
    expect(issue('I dont know ')[0]).toMatchObject({ original: 'dont', replacement: "don't" });
  });

  it('offers no fix for a word the dictionary does not know (Add to team words)', () => {
    expect(issue('the zxqvbn is here ')[0]).toMatchObject({ suggestions: [], replacement: null });
  });

  it('applies a first suggestion only when it is clearly the best', () => {
    expect(safeFix('tommorow', ['tomorrow'])).toBe('tomorrow');
    expect(safeFix('teh', ['the', 'tech'])).toBe('the');
    expect(safeFix('wich', ['which', 'rich'])).toBe('which');
    expect(safeFix('deliverd', ['delivers', 'deliver', 'delivered'])).toBeNull();
    expect(safeFix('xyz', [])).toBeNull();
    expect(safeFix('qwrtpl', ['quartile'])).toBeNull();
  });

  it('ranks the real dictionary suggestions for typing slips', () => {
    const fix = (word: string) => {
      const ranked = rankSuggestions(word, speller.suggest(word), speller);
      return safeFix(word, ranked);
    };
    expect(fix('teh')).toBe('the');
    expect(fix('hte')).toBe('the');
    expect(fix('waht')).toBe('what');
    expect(fix('chekc')).toBe('check');
    expect(fix('pirce')).toBe('price');
    expect(fix('thier')).toBe('their');
    expect(fix('thnks')).toBe('thanks');
    expect(fix('recieve')).toBe('receive');
    expect(fix('paymnet')).toBe('payment');
    // Too close to call: shown as choices in the card, never applied by Fix all.
    expect(fix('wich')).toBeNull();
    expect(rankSuggestions('wich', speller.suggest('wich'), speller).slice(0, 2)).toEqual(
      expect.arrayContaining(['which', 'with']),
    );
    // A common business word wins a tie with a rare one.
    expect(fix('quanity')).toBe('quantity');
  });

  it('measures edits with transpositions', () => {
    expect(editDistance('teh', 'the')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(matchCase('Pls', 'please', false)).toBe('Please');
    expect(matchCase('i', 'I', false)).toBe('I');
  });
});

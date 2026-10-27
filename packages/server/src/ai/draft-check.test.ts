import { describe, expect, it } from 'vitest';
import {
  acceptCompletion,
  checkCompletion,
  continuationOf,
  acceptDrafts,
  ungroundedNumbers,
  type DraftOutput,
} from './draft-check.js';

const SOURCES =
  'Nasi Lemak Ayam RM12. Kopi O RM3.50. Delivery within 5 km. Order #1042, pickup at 1pm.';
const INTERNAL = ['Our supplier is Pak Ali at Jalan Kebun 12 and we pay him only RM4 per box'];
const draft = (text: string, label = 'Answer now', grounded = true) => ({ label, text, grounded });
const output = (
  suggestions: DraftOutput['suggestions'],
  extra: Partial<DraftOutput> = {},
): DraftOutput => ({
  suggestions,
  noAnswer: false,
  handoffRule: null,
  ...extra,
});

describe('ungroundedNumbers', () => {
  it('lists a number that no source contains', () => {
    expect(ungroundedNumbers('It is RM15 each.', SOURCES)).toEqual(['15']);
  });

  it('accepts numbers from the sources, decimals and order numbers included', () => {
    expect(ungroundedNumbers('RM12 and RM3.50, order #1042, within 5 km', SOURCES)).toEqual([]);
  });

  it('accepts the same value written another way', () => {
    expect(
      ungroundedNumbers('RM1500 and RM15.00', 'Catering from RM 1,500. Nasi Lemak RM15.'),
    ).toEqual([]);
  });

  it('derives sums and products only from the business prices', () => {
    // 3 × 5 = 15, but those numbers come from the chat, not from a price list.
    expect(ungroundedNumbers('RM15 each', 'Call me at 3 or 5', 'Nasi Lemak RM12')).toEqual(['15']);
    expect(ungroundedNumbers('RM24 for two', 'Two please', 'Nasi Lemak RM12')).toEqual([]);
  });

  it('accepts a sum or a product of two source numbers', () => {
    expect(ungroundedNumbers('Two for RM24, or RM15.50 with a Kopi O.', SOURCES)).toEqual([]);
  });
});

describe('acceptDrafts', () => {
  it('keeps two grounded, different drafts', () => {
    const result = acceptDrafts(
      output([
        draft('Nasi Lemak Ayam is RM12.'),
        draft('What time is the pickup?', 'Ask the time'),
      ]),
      SOURCES,
      INTERNAL,
    );
    expect(result).toEqual({
      suggestions: [
        { label: 'Answer now', text: 'Nasi Lemak Ayam is RM12.' },
        { label: 'Ask the time', text: 'What time is the pickup?' },
      ],
      noAnswer: false,
      handoffRule: null,
    });
  });

  it('drops a grounded draft with a number not in the sources', () => {
    const result = acceptDrafts(output([draft('Nasi Lemak Ayam is RM15.')]), SOURCES, INTERNAL);
    expect(result).toEqual({ suggestions: [], noAnswer: true, handoffRule: null });
  });

  it('keeps a total of listed prices', () => {
    expect(
      acceptDrafts(output([draft('Two for RM24.')]), SOURCES, INTERNAL).suggestions,
    ).toHaveLength(1);
  });

  it('drops a draft the model did not mark grounded', () => {
    expect(
      acceptDrafts(output([draft('We open on Hari Raya.', 'Hours', false)]), SOURCES, INTERNAL),
    ).toMatchObject({ suggestions: [], noAnswer: true });
  });

  it('drops a draft that leaks an Internal item', () => {
    const leak = draft(
      'Fun fact: our supplier is Pak Ali at Jalan Kebun and we pay him only a little.',
    );
    const exact = draft(`Note: ${INTERNAL[0]!.slice(0, 50)}`);
    expect(
      acceptDrafts(output([leak, exact]), SOURCES, INTERNAL).suggestions.map((s) => s.text),
    ).toEqual([leak.text]);
  });

  it('drops a draft that copies a short Internal item, ignoring very short ones', () => {
    const internal = ['Supplier: Ah Seng Trading Klang', 'VIP'];
    expect(
      acceptDrafts(
        output([draft('We buy from SUPPLIER:  ah seng trading klang.')]),
        SOURCES,
        internal,
      ).suggestions,
    ).toEqual([]);
    expect(
      acceptDrafts(output([draft('Hi! You are a VIP to us.')]), SOURCES, internal).suggestions,
    ).toHaveLength(1);
  });

  it('drops a draft longer than 4,096 characters', () => {
    expect(
      acceptDrafts(output([draft(`Hi! ${'Nasi Lemak Ayam. '.repeat(300)}`)]), SOURCES, INTERNAL)
        .suggestions,
    ).toEqual([]);
  });

  it('returns a note instead of drafts when a hand-off rule matches', () => {
    expect(
      acceptDrafts(output([draft('Sorry!')], { handoffRule: 'Order problems' }), SOURCES, INTERNAL),
    ).toEqual({ suggestions: [], noAnswer: false, handoffRule: 'Order problems' });
  });

  it('drops a near-copy of the first draft', () => {
    const result = acceptDrafts(
      output([draft('Nasi Lemak Ayam is RM12.'), draft('  nasi lemak ayam   IS rm12. ', 'Again')]),
      SOURCES,
      INTERNAL,
    );
    expect(result.suggestions).toHaveLength(1);
  });

  it('trims a long label at a word and stays within 40 characters', () => {
    const [chip] = acceptDrafts(
      output([
        draft('Nasi Lemak Ayam is RM12.', 'Confirm the price and ask for the pickup name please'),
      ]),
      SOURCES,
      INTERNAL,
    ).suggestions;
    expect(chip!.label).toBe('Confirm the price and ask for the…');
    expect(chip!.label.length).toBeLessThanOrEqual(40);
  });

  it('drops a blank draft', () => {
    expect(acceptDrafts(output([draft('   ')]), SOURCES, INTERNAL).suggestions).toEqual([]);
  });
});

describe('continuationOf (the grey text never repeats what was typed)', () => {
  it('cuts a full echo and keeps the space after the finished word', () => {
    expect(continuationOf('hi what', 'hi what would you like to know?')).toBe(
      ' would you like to know?',
    );
    // Case and extra spaces do not matter; a leading space in the answer is ignored.
    expect(continuationOf('Hi  What', ' hi what would you like?')).toBe(' would you like?');
  });

  it('cuts an echo of only the current sentence or the last words', () => {
    expect(continuationOf('Thanks Jazz. sure do', 'sure do drop us a message early.')).toBe(
      ' drop us a message early.',
    );
    expect(continuationOf('hi what', 'what would you like?')).toBe(' would you like?');
  });

  it('finishes a half-typed word without a space', () => {
    expect(continuationOf('Hi Nu', 'Hi Nurul, how can we help?')).toBe('rul, how can we help?');
    expect(continuationOf('Hi Nu', 'Nurul, how can we help?')).toBe('rul, how can we help?');
  });

  it('after a typed space the grey text starts without one', () => {
    expect(continuationOf('Two Nasi ', 'Two Nasi Lemak Ayam')).toBe('Lemak Ayam');
    expect(continuationOf('Two Nasi ', ' Lemak Ayam')).toBe('Lemak Ayam');
  });

  it('keeps an answer that holds only the new words', () => {
    expect(continuationOf('Two Nasi ', 'Lemak Ayam')).toBe('Lemak Ayam');
    expect(continuationOf('hi what', ' would you like?')).toBe(' would you like?');
    // A word inside a typed word is no word start: "at" in "what" is not cut.
    expect(continuationOf('hi what', 'at the shop')).toBe('at the shop');
  });

  it('works for Chinese (every character is a word start)', () => {
    expect(continuationOf('您好，请问', '请问您需要什么？')).toBe('您需要什么？');
  });
});

describe('acceptCompletion', () => {
  const done = (completion: string | null, grounded = true) => ({ completion, grounded });

  it('shows only what comes after the typed text, and nothing for a pure echo', () => {
    expect(
      acceptCompletion(done('hi what would you like to know?'), 'hi what', SOURCES, INTERNAL),
    ).toBe(' would you like to know?');
    expect(checkCompletion(done('Hi what'), 'hi what', SOURCES, INTERNAL)).toEqual({
      completion: null,
      dropped: 'empty',
    });
  });

  it('cuts at the end of the sentence', () => {
    expect(
      acceptCompletion(done('Lemak Ayam is RM12. Anything else?'), 'Two Nasi ', SOURCES, INTERNAL),
    ).toBe('Lemak Ayam is RM12.');
  });

  it('rejects more than 120 characters', () => {
    expect(
      acceptCompletion(done(`Lemak ${'very '.repeat(30)}good`), 'Two Nasi ', SOURCES, INTERNAL),
    ).toBeNull();
  });

  it('rejects an ungrounded completion and a new number', () => {
    expect(
      acceptCompletion(done('Lemak is RM12.', false), 'Two Nasi ', SOURCES, INTERNAL),
    ).toBeNull();
    expect(acceptCompletion(done('Lemak is RM19.'), 'Two Nasi ', SOURCES, INTERNAL)).toBeNull();
  });

  it('rejects a blank completion and a leak', () => {
    expect(acceptCompletion(done('  '), 'Two Nasi ', SOURCES, INTERNAL)).toBeNull();
    expect(acceptCompletion(done(null), 'Two Nasi ', SOURCES, INTERNAL)).toBeNull();
    expect(
      acceptCompletion(done(INTERNAL[0]!.slice(0, 60)), 'By the way, ', SOURCES, INTERNAL),
    ).toBeNull();
  });
});

describe('checkCompletion', () => {
  const done = (completion: string | null, grounded = true) => ({ completion, grounded });
  const reason = (completion: string | null, grounded = true, typed = 'Two Nasi ') =>
    checkCompletion(done(completion, grounded), typed, SOURCES, INTERNAL).dropped;

  it('names why a completion was dropped, for the log', () => {
    expect(reason(null)).toBe('empty');
    expect(reason('  ')).toBe('empty');
    expect(reason('Lemak is RM12.', false)).toBe('ungrounded');
    expect(reason(`Lemak ${'very '.repeat(30)}good`)).toBe('too_long');
    expect(reason('Lemak is RM19.')).toBe('number');
    expect(reason(INTERNAL[0]!.slice(0, 60), true, 'By the way, ')).toBe('internal');
  });

  it('keeps a wording-only completion and reports no drop', () => {
    expect(
      checkCompletion(done('any other questions?'), 'Do you have ', SOURCES, INTERNAL),
    ).toEqual({ completion: 'any other questions?', dropped: null });
  });
});

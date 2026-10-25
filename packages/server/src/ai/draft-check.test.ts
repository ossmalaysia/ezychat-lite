import { describe, expect, it } from 'vitest';
import {
  acceptCompletion,
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

describe('acceptCompletion', () => {
  const done = (completion: string | null, grounded = true) => ({ completion, grounded });

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

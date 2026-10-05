import { expect, it } from 'vitest';
import { migrateAiKnowledge } from './migrate.js';

it.each([
  [
    'notes only',
    { instructions: 'Be brief', notes: '  Open 9am to 5pm.  ' },
    { instructions: 'Be brief', context: 'Open 9am to 5pm.', truncated: false },
  ],
  [
    'FAQs only',
    {
      notes: '',
      faqs: [
        { question: 'Open on Sunday?', answer: 'No' },
        { question: 'Delivery?', answer: 'RM10' },
      ],
    },
    {
      instructions: '',
      context: 'Q: Open on Sunday?\nA: No\n\nQ: Delivery?\nA: RM10',
      truncated: false,
    },
  ],
  [
    'notes and FAQs',
    { instructions: 'Hi', notes: 'Open 9am.', faqs: [{ question: 'Halal?', answer: 'Yes' }] },
    { instructions: 'Hi', context: 'Open 9am.\n\nQ: Halal?\nA: Yes', truncated: false },
  ],
  ['empty', {}, { instructions: '', context: '', truncated: false }],
  [
    'already the new shape',
    { instructions: 'Be kind', context: '  Delivery RM10\n\n' },
    { instructions: 'Be kind', context: '  Delivery RM10\n\n', truncated: false },
  ],
])('migrates %s', (_name, stored, expected) => {
  expect(migrateAiKnowledge(stored)).toEqual(expected);
});

it('keeps 60,000 characters of notes and FAQs intact', () => {
  const result = migrateAiKnowledge({
    notes: 'a'.repeat(30_000),
    faqs: [{ question: 'Q', answer: 'b'.repeat(30_000) }],
  });
  expect(result.truncated).toBe(false);
  expect(result.context).toBe(`${'a'.repeat(30_000)}\n\nQ: Q\nA: ${'b'.repeat(30_000)}`);
});

it('keeps the first 100,000 code points of larger knowledge and reports it', () => {
  const result = migrateAiKnowledge({
    notes: 'a'.repeat(90_000),
    faqs: [{ question: 'Q', answer: 'b'.repeat(20_000) }],
  });
  expect(result.truncated).toBe(true);
  expect(result.context).toHaveLength(100_000);
  expect(result.context.startsWith('a'.repeat(90_000))).toBe(true);
});

it('never splits an emoji at the 100,000 code point boundary', () => {
  // 99,999 letters, then emoji: the emoji is code point 100,000 (UTF-16 units 100,000-100,001).
  const result = migrateAiKnowledge({ notes: `${'a'.repeat(99_999)}😀😀tail` });
  expect(result.truncated).toBe(true);
  expect(result.context).toBe(`${'a'.repeat(99_999)}😀`);
  expect(result.context.endsWith('\uD83D')).toBe(false);
  const emojis = migrateAiKnowledge({ notes: '😀'.repeat(100_001) });
  expect([...emojis.context]).toHaveLength(100_000);
  expect(emojis.context).toBe('😀'.repeat(100_000));
});

it('ignores malformed stored values instead of failing to load', () => {
  expect(
    migrateAiKnowledge({ instructions: 3, notes: null, faqs: [{ question: 'Q' }, 'x'] }),
  ).toEqual({ instructions: '', context: '', truncated: false });
  expect(migrateAiKnowledge(null)).toEqual({ instructions: '', context: '', truncated: false });
});

it('caps a stored Business context text at 100,000 code points', () => {
  const result = migrateAiKnowledge({ context: 'c'.repeat(100_005) });
  expect(result.truncated).toBe(true);
  expect(result.context).toBe('c'.repeat(100_000));
});

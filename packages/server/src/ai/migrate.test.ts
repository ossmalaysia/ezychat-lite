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

it('keeps the start of migrated knowledge over 40,000 characters and reports it', () => {
  const result = migrateAiKnowledge({
    notes: 'a'.repeat(30_000),
    faqs: [{ question: 'Q', answer: 'b'.repeat(20_000) }],
  });
  expect(result.truncated).toBe(true);
  expect(result.context).toHaveLength(40_000);
  expect(result.context.startsWith('a'.repeat(30_000))).toBe(true);
});

it('ignores malformed stored values instead of failing to load', () => {
  expect(
    migrateAiKnowledge({ instructions: 3, notes: null, faqs: [{ question: 'Q' }, 'x'] }),
  ).toEqual({ instructions: '', context: '', truncated: false });
  expect(migrateAiKnowledge(null)).toEqual({ instructions: '', context: '', truncated: false });
});

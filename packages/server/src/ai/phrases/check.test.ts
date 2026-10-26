import { describe, expect, it } from 'vitest';
import { acceptPhrases, cleanTeamReply, planPhraseMerge } from './check.js';
import type { StoredPhrase } from './repo.js';

const BUSINESS = '[Menu]\nNasi Lemak Ayam RM12. Kopi O RM3.50. Open daily 8am to 10pm.';
const INTERNAL = ['Our supplier Ah Seng gives us a special discount every Monday morning.'];
const sources = {
  business: BUSINESS,
  internalTexts: INTERNAL,
  names: ['Nurul Huda', 'Nurul', 'Huda'],
};

describe('cleanTeamReply', () => {
  it('removes emails, long numbers and the chat names, keeps the wording', () => {
    expect(
      cleanTeamReply(
        'Hi Nurul Huda, call 012-345 6789 or mail nurul@example.com. Order of 2 is fine.',
        ['Nurul Huda', 'Nurul'],
      ),
    ).toBe('Hi [name], call [number] or mail [email]. Order of 2 is fine.');
  });

  it('replaces a name only as a whole word', () => {
    expect(cleanTeamReply('Ali, the alibi is fine', ['Ali'])).toBe('[name], the alibi is fine');
  });
});

describe('acceptPhrases', () => {
  const take = (text: string, source: 'context' | 'team' = 'team') =>
    acceptPhrases([{ text, language: 'en', source }], sources);

  it('keeps a good phrase and marks a phrase with a number as a fact', () => {
    expect(take('Thank you for your message!').accepted).toEqual([
      { text: 'Thank you for your message!', language: 'en', source: 'team', fact: false },
    ]);
    expect(take('Nasi Lemak Ayam is RM12.', 'context').accepted[0]?.fact).toBe(true);
  });

  it('drops what must never reach a customer, and says why', () => {
    const { accepted, dropped } = acceptPhrases(
      [
        { text: 'Hi', language: 'en', source: 'team' },
        { text: '/menu please', language: 'en', source: 'team' },
        { text: 'Hi [name], thanks!', language: 'en', source: 'team' },
        { text: 'Nasi Lemak Ayam is RM15.', language: 'en', source: 'context' },
        {
          text: 'Our supplier Ah Seng gives us a special discount every Monday.',
          language: 'en',
          source: 'context',
        },
        { text: 'Thanks Nurul, see you soon!', language: 'en', source: 'team' },
        { text: 'See you soon!', language: 'en', source: 'team' },
        { text: '  see   you SOON! ', language: 'en', source: 'team' },
      ],
      sources,
    );
    expect(accepted.map((p) => p.text)).toEqual(['See you soon!']);
    expect(dropped).toEqual({
      length: 1,
      command: 1,
      placeholder: 1,
      number: 1,
      internal: 1,
      name: 1,
      duplicate: 1,
    });
  });
});

describe('planPhraseMerge', () => {
  const stored = (over: Partial<StoredPhrase> & { id: number; text: string }): StoredPhrase => ({
    language: 'en',
    source: 'team',
    uses: 0,
    fact: false,
    createdAt: 1,
    ...over,
  });

  it('keeps admin and used phrases, replaces unused ones, adds only new text', () => {
    const plan = planPhraseMerge(
      [
        stored({ id: 1, text: 'Please send the receipt.', source: 'admin' }),
        stored({ id: 2, text: 'Thank you for your message!', uses: 4 }),
        stored({ id: 3, text: 'Unused old phrase.' }),
        stored({ id: 4, text: 'See you soon!' }),
      ],
      [
        { text: 'see you soon!', language: 'en', source: 'team', fact: false },
        { text: 'Is it for delivery or pickup?', language: 'en', source: 'team', fact: false },
        { text: 'Thank you for your message!', language: 'en', source: 'team', fact: false },
      ],
      BUSINESS,
    );
    expect(plan.drop).toEqual([3]);
    expect(plan.add.map((p) => p.text)).toEqual(['Is it for delivery or pickup?']);
  });

  it('drops a used fact phrase once its number left the business context', () => {
    const plan = planPhraseMerge(
      [stored({ id: 5, text: 'Teh Tarik is RM4.', fact: true, uses: 9, source: 'context' })],
      [],
      BUSINESS,
    );
    expect(plan.drop).toEqual([5]);
  });
});

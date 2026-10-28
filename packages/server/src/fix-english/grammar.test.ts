import { describe, expect, it } from 'vitest';
import { GRAMMAR_ISSUES_MAX, grammarIssues } from './grammar.js';

const pairs = (text: string, corrected: string) =>
  grammarIssues(text, corrected).map((i) => {
    expect(text.slice(i.start, i.end)).toBe(i.original);
    return [i.original, i.replacement];
  });

describe('grammarIssues', () => {
  it('marks each changed word on the original positions', () => {
    expect(
      pairs(
        'Hi Farah, your order have been ship. pls check you email for a update.',
        'Hi Farah, your order has been shipped. Please check your email for an update.',
      ),
    ).toEqual([
      ['have', 'has'],
      ['ship', 'shipped'],
      ['pls', 'Please'],
      ['you', 'your'],
      ['a', 'an'],
    ]);
  });

  it('attaches an insertion to the next word, or the word before at the end', () => {
    expect(pairs('please check email now', 'please check your email now')).toEqual([
      ['email', 'your email'],
    ]);
    expect(pairs('i will send it tomorrow', 'I will send it tomorrow.')).toEqual([
      ['i', 'I'],
      ['tomorrow', 'tomorrow.'],
    ]);
  });

  it('marks a removed word', () => {
    expect(pairs('the the order is ready', 'the order is ready')).toEqual([['the ', '']]);
  });

  it('never touches numbers, links, emails or mentions', () => {
    expect(pairs('The price is RM12 for 2 pax', 'The price is RM15 for two pax')).toEqual([]);
    expect(pairs('see www.kopi.my/menu ok', 'see www.kopi.my/menus ok')).toEqual([]);
    expect(pairs('mail aisyah@kopi.my pls', 'mail aisyah@kopi.com pls')).toEqual([]);
  });

  it('drops a rewrite: long phrases, or half the words changed', () => {
    expect(
      pairs(
        'Hi, can you send me your address?',
        'Hello, could you please kindly send over your full home address to us today?',
      ),
    ).toEqual([]);
    expect(
      pairs('we go there tomorrow', 'we shall travel to that place by tomorrow morning'),
    ).toEqual([]);
  });

  it('ignores unchanged text, spacing-only changes and an empty answer', () => {
    expect(pairs('ok lah, see you', 'ok lah, see you')).toEqual([]);
    expect(pairs('ok  lah see you', 'ok lah see you')).toEqual([]);
    expect(pairs('ok lah see you', '   ')).toEqual([]);
  });

  it(`returns at most ${GRAMMAR_ISSUES_MAX} marks`, () => {
    const text = Array.from({ length: 120 }, () => 'i go and').join(' ');
    const corrected = Array.from({ length: 120 }, () => 'I go and').join(' ');
    expect(grammarIssues(text, corrected)).toHaveLength(GRAMMAR_ISSUES_MAX);
  });
});

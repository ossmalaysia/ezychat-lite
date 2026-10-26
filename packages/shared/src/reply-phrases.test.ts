import { describe, expect, it } from 'vitest';
import { ReplyPhraseBody, ReplySuggestionsBody, matchPhrase } from './index.js';

const LIST = [
  {
    id: 1,
    text: 'Thank you for your message! We will get back to you shortly.',
    language: 'en' as const,
  },
  { id: 2, text: 'Our opening hours are 8am to 10pm daily.', language: 'en' as const },
  {
    id: 3,
    text: 'Terima kasih atas mesej anda! Kami akan balas secepat mungkin.',
    language: 'ms' as const,
  },
  { id: 4, text: '谢谢您的留言！我们会尽快回复您。', language: 'zh' as const },
  { id: 5, text: 'Please tell us before you come.', language: 'en' as const },
];

describe('matchPhrase', () => {
  it('continues a phrase after the last typed words', () => {
    expect(matchPhrase(LIST, 'Thank you for ')).toEqual({
      id: 1,
      rest: 'your message! We will get back to you shortly.',
    });
    expect(matchPhrase(LIST, 'Hi Nurul, thank you ')).toEqual({
      id: 1,
      rest: 'for your message! We will get back to you shortly.',
    });
  });

  it('finishes a half-typed word, with no space before the rest', () => {
    expect(matchPhrase(LIST, 'Our open')).toEqual({
      id: 2,
      rest: 'ing hours are 8am to 10pm daily.',
    });
  });

  it('adds the space when the typed text ends with a full word', () => {
    expect(matchPhrase(LIST, 'Our opening')?.rest).toBe(' hours are 8am to 10pm daily.');
  });

  it('matches Malay and Chinese (each Chinese character is a word)', () => {
    expect(matchPhrase(LIST, 'Terima kasih ')?.id).toBe(3);
    expect(matchPhrase(LIST, '谢谢您')).toEqual({ id: 4, rest: '的留言！我们会尽快回复您。' });
  });

  it('needs at least 2 words, never matches inside a word, never for a quick reply', () => {
    expect(matchPhrase(LIST, 'Thank')).toBeNull();
    expect(matchPhrase(LIST, '谢')).toBeNull();
    expect(matchPhrase(LIST, '/thank you')).toBeNull();
    // "us before" is in phrase 5; "be" alone inside "before" must not count as a start.
    expect(matchPhrase(LIST, 'tell us be')?.id).toBe(5);
    // "hank you" is inside "Thank you": a Latin match must start at a word start.
    expect(matchPhrase(LIST, 'hank you ')).toBeNull();
  });

  it('shows nothing when the phrase is already typed to its end', () => {
    expect(matchPhrase(LIST, 'back to you shortly.')).toBeNull();
  });

  it('uses the first match: the list comes most used first', () => {
    const list = [{ id: 7, text: 'Thank you for waiting.', language: 'en' as const }, ...LIST];
    expect(matchPhrase(list, 'thank you for ')?.id).toBe(7);
  });
});

describe('phrase and switch bodies', () => {
  it('trims and limits a phrase', () => {
    expect(ReplyPhraseBody.parse({ text: '  Hello there  ', language: 'en' }).text).toBe(
      'Hello there',
    );
    expect(ReplyPhraseBody.safeParse({ text: 'Hi', language: 'en' }).success).toBe(false);
    expect(ReplyPhraseBody.safeParse({ text: 'x'.repeat(201), language: 'en' }).success).toBe(
      false,
    );
    expect(ReplyPhraseBody.safeParse({ text: 'Hello there', language: 'fr' }).success).toBe(false);
  });

  it('takes the switch, the model or both, never neither', () => {
    expect(ReplySuggestionsBody.safeParse({ enabled: true }).success).toBe(true);
    expect(ReplySuggestionsBody.safeParse({ model: 'fast' }).success).toBe(true);
    expect(ReplySuggestionsBody.safeParse({}).success).toBe(false);
    expect(ReplySuggestionsBody.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
  });
});

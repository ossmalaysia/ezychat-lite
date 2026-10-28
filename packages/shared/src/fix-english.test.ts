import { describe, expect, it } from 'vitest';
import {
  FixEnglishStatus,
  FixGrammarBody,
  FixGrammarResult,
  TeamWordBody,
  TeamWordsResult,
  acceptedWords,
  notEnglish,
} from './fix-english.js';

describe('Fix English contract', () => {
  it('fills defaults for fields an older server leaves out', () => {
    expect(
      FixEnglishStatus.parse({ enabled: true, connected: false, spelling: 'on', grammar: 'none' }),
    ).toMatchObject({ upgraded: false });
    expect(TeamWordsResult.parse({ words: [] })).toEqual({ words: [], businessWords: [] });
  });

  it('accepts a draft up to 4096 characters', () => {
    expect(FixGrammarBody.safeParse({ text: 'x'.repeat(4096) }).success).toBe(true);
    expect(FixGrammarBody.safeParse({ text: 'x'.repeat(4097) }).success).toBe(false);
    expect(FixGrammarBody.safeParse({ text: '' }).success).toBe(false);
  });

  it('reads both result shapes', () => {
    expect(FixGrammarResult.parse({ status: 'skipped', reason: 'not_english' }).status).toBe(
      'skipped',
    );
    expect(
      FixGrammarResult.parse({
        status: 'checked',
        issues: [{ start: 0, end: 1, original: 'i', replacement: 'I' }],
      }),
    ).toMatchObject({ issues: [{ replacement: 'I' }] });
  });

  it('takes team words of letters, trimmed, with single spaces', () => {
    expect(TeamWordBody.parse({ word: '  nasi   lemak ' }).word).toBe('nasi lemak');
    expect(TeamWordBody.parse({ word: "Kak Ros's" }).word).toBe("Kak Ros's");
    expect(TeamWordBody.parse({ word: 'char-kway' }).word).toBe('char-kway');
    for (const word of ['RM12', 'kopi.my', '', 'a'.repeat(41)])
      expect(TeamWordBody.safeParse({ word }).success).toBe(false);
  });
});

describe('notEnglish', () => {
  it('treats Chinese, Tamil and two Malay words as not English', () => {
    expect(notEnglish('你好, can I help?')).toBe(true);
    expect(notEnglish('வணக்கம் sir')).toBe(true);
    expect(notEnglish('Boleh, saya check dulu ya')).toBe(true);
  });

  it('keeps English with one Malay word or Manglish particles', () => {
    expect(notEnglish('ok boleh, I check first lah')).toBe(false);
    expect(notEnglish('Your order is ready ya')).toBe(false);
  });
});

describe('acceptedWords', () => {
  it('splits team words into single lower-case words and adds the business words', () => {
    expect([...acceptedWords([{ word: 'Nasi Lemak' }, { word: 'char-kway' }], ['kopi'])]).toEqual([
      'nasi',
      'lemak',
      'char',
      'kway',
      'kopi',
    ]);
  });
});

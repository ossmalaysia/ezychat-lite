import { describe, expect, it } from 'vitest';
import { ReplySuggestionsResult, ReplySuggestionsStatus, completionReady } from './index.js';

describe('completionReady', () => {
  it('is true only after a full word and a space or punctuation', () => {
    expect(completionReady('Hi Nurul ')).toBe(true);
    expect(completionReady('Hi Nurul,')).toBe(true);
    expect(completionReady('Hi Nu')).toBe(false);
    expect(completionReady('')).toBe(false);
    expect(completionReady('   ')).toBe(false);
  });

  it('uses punctuation as the word boundary for Chinese text', () => {
    expect(completionReady('你好，')).toBe(true);
    expect(completionReady('你好')).toBe(false);
  });

  it('is false for a quick-reply command', () => {
    expect(completionReady('/menu ')).toBe(false);
    expect(completionReady('  /menu ')).toBe(false);
  });
});

describe('ReplySuggestionsResult', () => {
  const draft = { label: 'Share the menu prices', text: 'Nasi Lemak Ayam is RM12.' };

  it('accepts at most two suggestions', () => {
    expect(
      ReplySuggestionsResult.safeParse({
        suggestions: [draft, draft, draft],
        noAnswer: false,
        handoffRule: null,
      }).success,
    ).toBe(false);
    expect(
      ReplySuggestionsResult.safeParse({
        suggestions: [draft, draft],
        noAnswer: false,
        handoffRule: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a label longer than 40 characters', () => {
    expect(
      ReplySuggestionsResult.safeParse({
        suggestions: [{ ...draft, label: 'x'.repeat(41) }],
        noAnswer: false,
        handoffRule: null,
      }).success,
    ).toBe(false);
  });
});

describe('ReplySuggestionsStatus', () => {
  it('defaults upgraded to false for an older server', () => {
    expect(
      ReplySuggestionsStatus.parse({ enabled: true, connected: true, state: 'on' }).upgraded,
    ).toBe(false);
  });
});

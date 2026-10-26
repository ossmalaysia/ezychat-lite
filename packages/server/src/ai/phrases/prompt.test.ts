import { describe, expect, it } from 'vitest';
import { GUARDRAILS } from '../prompt.js';
import { PHRASE_RULES, PhraseOutput, buildPhrasePrompt } from './prompt.js';

describe('buildPhrasePrompt', () => {
  it('puts the fixed rules first and the per-agent texts after them', () => {
    const p = buildPhrasePrompt({
      instructions: 'Be warm.',
      businessKnowledge: '[Menu]\nNasi Lemak RM12.',
      teamReplies: ['Thanks [name]!'],
      existingPhrases: [{ text: 'See you soon!', language: 'en' }],
    });
    expect(p.instructions.startsWith(`${GUARDRAILS}\n\n${PHRASE_RULES}\n`)).toBe(true);
    expect(p.instructions.endsWith('Be warm.')).toBe(true);
    expect(Object.keys(JSON.parse(p.input))).toEqual([
      'businessKnowledge',
      'teamReplies',
      'existingPhrases',
    ]);
  });

  it('keeps the rules free of per-call values and asks for native phrases per language', () => {
    expect(PHRASE_RULES).not.toMatch(/\$\{/);
    expect(PHRASE_RULES).toContain('never translate');
    expect(PHRASE_RULES).toContain('never invent a price');
  });

  it('accepts only the three languages and two AI sources', () => {
    expect(
      PhraseOutput.safeParse({ phrases: [{ text: 'Hi there', language: 'fr', source: 'team' }] })
        .success,
    ).toBe(false);
    expect(
      PhraseOutput.safeParse({ phrases: [{ text: 'Hi there', language: 'ms', source: 'admin' }] })
        .success,
    ).toBe(false);
  });
});

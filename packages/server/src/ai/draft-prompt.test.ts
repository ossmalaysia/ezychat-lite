import { describe, expect, it } from 'vitest';
import { DRAFT_RULES, buildDraftPrompt } from './draft-prompt.js';
import { GUARDRAILS } from './prompt.js';

const base = {
  kind: 'suggest' as const,
  instructions: 'Be warm and short.',
  handoffRules: 'Order problems and complaints go to a person.',
  internalKnowledge: 'MARK-internal margin 40%',
  businessKnowledge: 'Nasi Lemak Ayam RM12. Delivery within 5 km of Georgetown.',
  conversation: [{ speaker: 'customer' as const, text: 'Can I order two Nasi Lemak?' }],
  customer: { name: 'Nurul Huda' },
  now: new Date('2026-10-26T04:00:00Z'),
  timeZone: 'Asia/Kuala_Lumpur',
};

describe('buildDraftPrompt', () => {
  it('starts with the unchanged GUARDRAILS block and then the fixed draft rules', () => {
    const { instructions } = buildDraftPrompt(base);
    expect(instructions.startsWith(GUARDRAILS)).toBe(true);
    expect(instructions.indexOf(DRAFT_RULES)).toBe(GUARDRAILS.length + 2);
  });

  it('never carries the live agent decision rules', () => {
    const { instructions } = buildDraftPrompt(base);
    expect(instructions).not.toContain('Does that answer your question?');
    expect(instructions).not.toContain('no_reply');
  });

  it('puts the admin instructions and hand-off rules after the fixed rules', () => {
    const { instructions } = buildDraftPrompt(base);
    expect(instructions.indexOf('Be warm and short.')).toBeGreaterThan(
      instructions.indexOf(DRAFT_RULES),
    );
    expect(instructions).toContain('Order problems and complaints go to a person.');
  });

  it('keeps the input order of live replies, with the customer in the last block', () => {
    const input = JSON.parse(buildDraftPrompt(base).input) as Record<string, unknown>;
    expect(Object.keys(input)).toEqual([
      'internalKnowledge',
      'businessKnowledge',
      'conversation',
      'currentSituation',
    ]);
    expect(input.currentSituation).toMatchObject({
      date: '2026-10-26',
      time: '12:00',
      timeZone: 'Asia/Kuala_Lumpur',
      customer: { name: 'Nurul Huda' },
    });
  });

  it('adds the typed text only for a completion', () => {
    const suggest = JSON.parse(buildDraftPrompt(base).input) as {
      currentSituation: Record<string, unknown>;
    };
    expect(suggest.currentSituation).not.toHaveProperty('typed');
    const complete = JSON.parse(
      buildDraftPrompt({ ...base, kind: 'complete', typed: 'Hi Nurul ' }).input,
    ) as {
      currentSituation: Record<string, unknown>;
    };
    expect(complete.currentSituation.typed).toBe('Hi Nurul ');
    expect(complete.currentSituation.task).toBe('complete');
  });

  it('gives the same instructions for different chats, so the prefix is cached', () => {
    const other = buildDraftPrompt({
      ...base,
      conversation: [{ speaker: 'customer', text: 'Ada hantar ke Bayan Lepas?' }],
      customer: null,
    });
    expect(other.instructions).toBe(buildDraftPrompt(base).instructions);
  });
});

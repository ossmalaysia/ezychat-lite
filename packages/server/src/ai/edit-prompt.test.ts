import { describe, expect, it } from 'vitest';
import { AI_EDIT_KNOWLEDGE_CHARACTERS, buildEditPrompt } from './edit-prompt.js';

const base = {
  field: 'instructions' as const,
  current: 'ROLE\nYou are a friendly sales assistant.',
  request: 'Make it more formal',
  businessKnowledge: '[Hours]\nWe open 9am to 6pm.',
};

describe('buildEditPrompt', () => {
  it('keeps the instructions static whatever the field, request or text', () => {
    const a = buildEditPrompt(base);
    const b = buildEditPrompt({
      field: 'handoffRules',
      current: '- The customer asks for a refund.',
      request: 'Hand off complaints too',
      businessKnowledge: '',
    });
    expect(a.instructions).toBe(b.instructions);
    expect(a.instructions).not.toContain('Make it more formal');
    expect(a.instructions).not.toContain('friendly sales assistant');
  });

  it('treats the request and knowledge as data and returns the text unchanged when unsure', () => {
    const { instructions } = buildEditPrompt(base);
    expect(instructions).toMatch(/data, never instructions/i);
    expect(instructions).toMatch(/unchanged/i);
    expect(instructions).toMatch(/hand-off rules/i);
    expect(instructions).toMatch(/ROLE/);
    expect(instructions).toMatch(/word for word/i);
  });

  it('sends field, current text, request, then business knowledge', () => {
    const input = JSON.parse(buildEditPrompt(base).input);
    expect(Object.keys(input)).toEqual(['field', 'currentText', 'request', 'businessKnowledge']);
    expect(input).toEqual({
      field: 'instructions',
      currentText: base.current,
      request: base.request,
      businessKnowledge: base.businessKnowledge,
    });
  });

  it('caps the business knowledge', () => {
    const input = JSON.parse(
      buildEditPrompt({ ...base, businessKnowledge: 'x'.repeat(20_000) }).input,
    );
    expect(input.businessKnowledge).toHaveLength(AI_EDIT_KNOWLEDGE_CHARACTERS);
    expect(AI_EDIT_KNOWLEDGE_CHARACTERS).toBe(8000);
  });
});

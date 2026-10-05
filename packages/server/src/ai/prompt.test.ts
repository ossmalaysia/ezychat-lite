import { expect, it } from 'vitest';
import { buildAiPrompt } from './prompt.js';

const knowledge = { displayName: 'Ezy', instructions: 'Be brief', notes: '', faqs: [] };

it('answers order and delivery-slot questions with known facts and keeps the chat', () => {
  const { instructions } = buildAiPrompt(knowledge, 'Delivery RM10', [], false);
  expect(instructions).toContain('say the team will confirm the slot or order');
  expect(instructions).toContain('choose answer or ask_resolution and keep the conversation');
  expect(instructions).toContain('Choose handoff only when the customer asks for a human');
  expect(instructions).not.toContain(
    'If information is missing, conflicting, sensitive or a human is requested, choose handoff',
  );
  expect(instructions).toContain('confirms, in any words');
  expect(instructions).toContain('Administrator instructions:\nBe brief');
});

it('asks "Does that answer your question?" in the customer language without inviting more', () => {
  const { instructions } = buildAiPrompt(knowledge, 'Delivery RM10', [], false);
  expect(instructions).toContain(
    'ask "Does that answer your question?" in the customer\'s language',
  );
  expect(instructions).not.toContain('anything else');
});

import { describe, expect, it } from 'vitest';
import { askEzyInstructions } from '../src/ask-ezy/prompt.js';

const base = {
  userName: 'Daniel',
  timeZone: 'Asia/Kuala_Lumpur',
  now: new Date('2026-10-30T02:00:00Z'),
  chat: null,
};

describe('askEzyInstructions', () => {
  it('keeps the fixed rules first and puts per-call values after them', () => {
    const text = askEzyInstructions({ ...base, isAdmin: true });
    expect(text.indexOf('Today is Friday, 30 October 2026 (Asia/Kuala_Lumpur).')).toBeGreaterThan(
      text.indexOf('propose_ai_setup_change'),
    );
    expect(text).toContain('You are talking to "Daniel", an admin');
    expect(text).not.toContain('The question is about one chat');
  });

  it('tells a team member they cannot change the agent and gives them a message for their admin', () => {
    const text = askEzyInstructions({ ...base, isAdmin: false });
    expect(text).toContain('cannot change the AI agent');
    expect(text).toContain('a short message they can send to their admin');
  });

  it('setup turn: asks one unknown at a time, agent first, never a vague choice, never a time zone', () => {
    const text = askEzyInstructions({ ...base, isAdmin: true, maxAgents: 1, setup: true });
    expect(text).toContain('Before any propose_* call');
    expect(text).toContain('One question = one unknown');
    expect(text).toContain('Ask about the agent first, then the chat, then the time');
    expect(text).toContain('Never a choice like "I\'ll clarify"');
    expect(text).toContain('always propose the agent AND its task in the same answer');
    expect(text).toContain('the last 4 digits of the number only');
    expect(text).toContain('Never ask for a time zone');
    expect(text).toContain('- question: {');
    expect(text).not.toContain('call start_setup');
    // The edition's limit is a per-call value: after the fixed rules.
    expect(text.indexOf('This app allows at most 1 AI agent.')).toBeGreaterThan(
      text.indexOf('task_proposal'),
    );
    expect(askEzyInstructions({ ...base, isAdmin: true, maxAgents: 3, setup: true })).toContain(
      'at most 3 AI agents.',
    );
  });

  it('normal turn: an admin hands setup over with start_setup; a member gets neither', () => {
    const admin = askEzyInstructions({ ...base, isAdmin: true, maxAgents: 1 });
    expect(admin).toContain('call start_setup and nothing else');
    // Improving an existing agent's answers stays on this turn (propose_ai_setup_change), never the setup turn.
    expect(admin).toContain('do not call start_setup: use propose_ai_setup_change');
    expect(admin).not.toContain('Setting up agents and scheduled tasks');
    expect(admin).not.toContain('agent_proposal');
    expect(admin).not.toContain('This app allows');
    const member = askEzyInstructions({ ...base, isAdmin: false, maxAgents: 1, setup: true });
    expect(member).not.toContain('start_setup');
    expect(member).not.toContain('Setting up agents');
  });

  it('names the chat the question is about', () => {
    const text = askEzyInstructions({
      ...base,
      isAdmin: false,
      chat: { jid: '60123@s.whatsapp.net', name: 'Farah "F" Aziz' },
    });
    expect(text).toContain(
      'The question is about one chat: "Farah \\"F\\" Aziz" (chat id 60123@s.whatsapp.net).',
    );
  });
});

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

  it('asks one question instead of guessing a setup detail, and never asks for a time zone', () => {
    const text = askEzyInstructions({ ...base, isAdmin: true, maxAgents: 1 });
    expect(text).toContain('Never guess a missing or unclear detail');
    expect(text).toContain('one question per answer');
    expect(text).toContain('the last 4 digits of the number only');
    expect(text).toContain('Never ask for a time zone');
    expect(text).toContain('- question: {');
    // The edition's limit is a per-call value: after the fixed rules.
    expect(text.indexOf('This app allows at most 1 AI agent.')).toBeGreaterThan(
      text.indexOf('task_proposal'),
    );
    expect(askEzyInstructions({ ...base, isAdmin: true, maxAgents: 3 })).toContain(
      'at most 3 AI agents.',
    );
    expect(askEzyInstructions({ ...base, isAdmin: false, maxAgents: 1 })).not.toContain(
      'This app allows',
    );
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

import { describe, expect, it } from 'vitest';
import type { AiMemberStatus } from '@wa-team-inbox/shared';
import { connectionReady, hasKnowledge, memberPill, officialLoginUrl } from './ai-status';

function status(): AiMemberStatus {
  return {
    member: null,
    settings: {
      displayName: 'Sales Agent',
      enabled: false,
      mode: 'api',
      model: '',
      instructions: '',
      notes: '',
      faqs: [],
    },
    hasApiKey: true,
    connection: { state: 'signed_out', loginUrl: null, error: null },
    documents: [],
  };
}
const empty = { displayName: 'A', instructions: '', notes: '', faqs: [] };

describe('AI status helpers', () => {
  it('accepts only official sign-in links', () => {
    expect(officialLoginUrl('https://auth.openai.com/oauth/authorize?x=1')).toBe(
      'https://auth.openai.com/oauth/authorize?x=1',
    );
    expect(officialLoginUrl('https://evil.example/x')).toBeNull();
    expect(officialLoginUrl('https://auth.openai.com:8443/x')).toBeNull();
    expect(officialLoginUrl(null)).toBeNull();
  });

  it('knows when the saved connection can answer', () => {
    const s = status();
    expect(connectionReady(s)).toBe(true);
    s.hasApiKey = false;
    expect(connectionReady(s)).toBe(false);
    s.settings.mode = 'chatgpt';
    s.connection = { state: 'connected', loginUrl: null, error: null };
    expect(connectionReady(s)).toBe(true);
    s.connection = { state: 'expired', loginUrl: null, error: 'Sign in again' };
    expect(connectionReady(s)).toBe(false);
  });

  it('counts instructions, notes, complete FAQs or documents as knowledge', () => {
    expect(hasKnowledge(empty, 0)).toBe(false);
    expect(hasKnowledge({ ...empty, faqs: [{ question: 'Q', answer: '' }] }, 0)).toBe(false);
    expect(hasKnowledge({ ...empty, instructions: 'Be kind' }, 0)).toBe(true);
    expect(hasKnowledge({ ...empty, notes: 'RM10' }, 0)).toBe(true);
    expect(hasKnowledge({ ...empty, faqs: [{ question: 'Q', answer: 'A' }] }, 0)).toBe(true);
    expect(hasKnowledge(empty, 1)).toBe(true);
  });

  it('shows connection problems first, then missing knowledge, then on/off', () => {
    const s = status();
    s.hasApiKey = false;
    expect(memberPill(s, { ...empty, notes: 'x' })).toBe('needsConnection');
    s.hasApiKey = true;
    expect(memberPill(s, empty)).toBe('needsKnowledge');
    expect(memberPill(s, { ...empty, notes: 'x' })).toBe('off');
    s.member = {
      id: 3,
      username: 'ai',
      displayName: 'A',
      role: 'agent',
      kind: 'ai',
      mustChangePassword: false,
      disabled: false,
      createdAt: 1,
      locale: null,
    };
    expect(memberPill(s, { ...empty, notes: 'x' })).toBe('on');
  });
});

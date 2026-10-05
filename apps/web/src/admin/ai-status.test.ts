import { describe, expect, it } from 'vitest';
import type { AiDocument, AiMemberStatus } from '@wa-team-inbox/shared';
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
    },
    hasApiKey: true,
    connection: { state: 'signed_out', loginUrl: null, error: null },
    documents: [],
  };
}
const doc = (characters: number): AiDocument => ({
  id: 1,
  name: 'Business context',
  kind: 'text',
  size: characters,
  characters,
  createdAt: 1,
  updatedAt: 1,
});

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

  it('counts only context items with text as knowledge (instructions alone are not)', () => {
    expect(hasKnowledge([])).toBe(false);
    expect(hasKnowledge([doc(0)])).toBe(false);
    expect(hasKnowledge([doc(0), doc(12)])).toBe(true);
  });

  it('shows connection problems first, then missing knowledge, then on/off', () => {
    const s = status();
    s.hasApiKey = false;
    s.documents = [doc(5)];
    expect(memberPill(s)).toBe('needsConnection');
    s.hasApiKey = true;
    s.documents = [];
    expect(memberPill(s)).toBe('needsKnowledge');
    s.documents = [doc(5)];
    expect(memberPill(s)).toBe('off');
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
    expect(memberPill(s)).toBe('on');
  });
});

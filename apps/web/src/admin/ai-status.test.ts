import { afterEach, describe, expect, it } from 'vitest';
import {
  AI_AGENT_PRESETS,
  DEFAULT_AI_HANDOFF_RULES,
  DEFAULT_AI_INSTRUCTIONS,
  type AiDocument,
  type AiMemberStatus,
} from '@ezychat/shared';
import { activateLocale, i18n } from '@/i18n';
import ms from '../i18n/locales/ms/admin.json';
import zh from '../i18n/locales/zh-CN/admin.json';
import {
  connectionReady,
  hasKnowledge,
  isPresetDefault,
  memberPill,
  officialLoginUrl,
  presetDefaults,
} from './ai-status';

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
    agents: [],
    maxAgents: 1,
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
  internal: false,
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

describe('preset starting texts', () => {
  afterEach(async () => {
    await activateLocale('en');
  });

  it('gives each preset its localized starting texts, and Custom blank ones', async () => {
    const en = i18n.getFixedT('en', 'admin');
    expect(presetDefaults('sales', en)).toEqual({
      instructions: DEFAULT_AI_INSTRUCTIONS,
      handoffRules: DEFAULT_AI_HANDOFF_RULES,
    });
    expect(presetDefaults('faq', en)).toEqual(AI_AGENT_PRESETS.faq);
    expect(presetDefaults('custom', en)).toEqual({ instructions: '', handoffRules: '' });
    await activateLocale('ms');
    const malay = presetDefaults('faq', i18n.getFixedT('ms', 'admin'));
    expect(malay).toEqual(ms.ai.defaults.faq);
    expect(malay.instructions).not.toBe(AI_AGENT_PRESETS.faq.instructions);
  });

  it('knows a default of any preset in English or a loaded language, never edited text', async () => {
    expect(isPresetDefault(DEFAULT_AI_INSTRUCTIONS, 'instructions')).toBe(true);
    expect(isPresetDefault(DEFAULT_AI_HANDOFF_RULES, 'handoffRules')).toBe(true);
    expect(isPresetDefault(AI_AGENT_PRESETS.faq.handoffRules, 'handoffRules')).toBe(true);
    // The rules are not instructions, and an edited or blank text is never a default.
    expect(isPresetDefault(DEFAULT_AI_HANDOFF_RULES, 'instructions')).toBe(false);
    expect(isPresetDefault(`${DEFAULT_AI_INSTRUCTIONS}\nAlso sell cakes.`, 'instructions')).toBe(
      false,
    );
    expect(isPresetDefault('', 'instructions')).toBe(false);
    await activateLocale('zh-CN');
    expect(isPresetDefault(zh.ai.defaults.faq.instructions, 'instructions')).toBe(true);
    expect(isPresetDefault(zh.ai.defaults.sales.handoffRules, 'handoffRules')).toBe(true);
  });
});

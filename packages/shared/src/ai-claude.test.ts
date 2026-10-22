import { describe, expect, it } from 'vitest';
import {
  AiConnectionBody,
  AiKeyTestBody,
  AiMemberStatus,
  AiSettings,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODELS,
} from './ai.js';

describe('Claude API key connection', () => {
  it('lists three fixed models with Sonnet as the default', () => {
    expect(CLAUDE_MODELS).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']);
    expect(CLAUDE_DEFAULT_MODEL).toBe('claude-sonnet-5-5');
    expect(CLAUDE_MODELS).toContain(CLAUDE_DEFAULT_MODEL);
  });

  it('accepts the claude mode with the default or a listed model', () => {
    for (const model of ['', ...CLAUDE_MODELS])
      expect(
        AiConnectionBody.safeParse({ mode: 'claude', model, apiKey: 'sk-ant-api03-0123456789' })
          .success,
      ).toBe(true);
    expect(AiConnectionBody.safeParse({ mode: 'claude', model: '' }).success).toBe(true);
  });

  it('rejects a model outside the list in claude mode', () => {
    const result = AiConnectionBody.safeParse({ mode: 'claude', model: 'gpt-4.1-mini' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['model']);
  });

  it('keeps the api and chatgpt modes as before', () => {
    expect(AiConnectionBody.safeParse({ mode: 'api', model: 'gpt-4.1' }).success).toBe(true);
    expect(AiConnectionBody.safeParse({ mode: 'chatgpt', model: 'gpt-5.5' }).success).toBe(true);
    expect(AiConnectionBody.safeParse({ mode: 'gemini', model: '' }).success).toBe(false);
    expect(
      AiSettings.shape.mode.options.slice().sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual(['api', 'chatgpt', 'claude']);
  });

  it('tests an OpenAI key by default and a Claude key on request', () => {
    expect(AiKeyTestBody.parse({ apiKey: 'sk-1' })).toEqual({ apiKey: 'sk-1' });
    expect(AiKeyTestBody.parse({ apiKey: 'sk-ant-1', mode: 'claude' })).toEqual({
      apiKey: 'sk-ant-1',
      mode: 'claude',
    });
    expect(AiKeyTestBody.safeParse({ apiKey: 'x', mode: 'chatgpt' }).success).toBe(false);
  });

  it('defaults hasClaudeApiKey to false for an older server', () => {
    const status = AiMemberStatus.parse({
      member: null,
      settings: {
        displayName: 'AI',
        enabled: false,
        mode: 'claude',
        model: '',
        instructions: '',
      },
      hasApiKey: false,
      connection: { state: 'signed_out', loginUrl: null, error: null },
      documents: [],
    });
    expect(status.hasClaudeApiKey).toBe(false);
    expect(AiMemberStatus.parse({ ...status, hasClaudeApiKey: true }).hasClaudeApiKey).toBe(true);
  });
});

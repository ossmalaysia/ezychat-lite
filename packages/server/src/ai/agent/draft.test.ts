import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { OPENAI_DEFAULT_MODEL } from '../provider.js';
import { DRAFT_FAST_MODELS, draftModelSettings, runDraft } from './draft.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const answer = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});
const prompt = { instructions: 'Write drafts.', input: '{"conversation":[]}' };
const Schema = z.object({ completion: z.string().nullable(), grounded: z.boolean() });

describe('runDraft', () => {
  it('returns the structured output of one call without tools or retries', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [answer(JSON.stringify({ completion: 'Lemak Ayam is RM12.', grounded: true }))],
    });
    const output = await runDraft({
      model,
      prompt,
      schema: Schema,
      signal: new AbortController().signal,
      maxOutputTokens: 300,
    });
    expect(output).toEqual({ completion: 'Lemak Ayam is RM12.', grounded: true });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]!.tools ?? []).toEqual([]);
    expect(model.doGenerateCalls[0]!.maxOutputTokens).toBe(300);
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain('Write drafts.');
  });

  it('does not retry an answer outside the format', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer('{"reply":"no"}')] });
    await expect(
      runDraft({
        model,
        prompt,
        schema: Schema,
        signal: new AbortController().signal,
        maxOutputTokens: 300,
      }),
    ).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('throws when cancelled before the call', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV4({ doGenerate: [answer('{}')] });
    await expect(
      runDraft({ model, prompt, schema: Schema, signal: controller.signal, maxOutputTokens: 300 }),
    ).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe('draftModelSettings', () => {
  const claude = { mode: 'claude' as const, model: 'claude-opus-5-5' };

  it('uses the fast Claude model for a completion even when a larger one is saved', () => {
    expect(draftModelSettings(claude, true).model).toBe('claude-haiku-5-5');
    expect(DRAFT_FAST_MODELS.claude).toBe('claude-haiku-5-5');
  });

  it('keeps the fast OpenAI model equal to the app default model', () => {
    expect(DRAFT_FAST_MODELS.api).toBe(OPENAI_DEFAULT_MODEL);
  });

  it('uses the fixed small OpenAI model for a completion', () => {
    expect(draftModelSettings({ mode: 'api' as const, model: 'gpt-5.5' }, true).model).toBe(
      DRAFT_FAST_MODELS.api,
    );
  });

  it('keeps the saved model for suggestions and for ChatGPT sign-in', () => {
    expect(draftModelSettings(claude, false).model).toBe('claude-opus-5-5');
    expect(draftModelSettings({ mode: 'chatgpt' as const, model: 'gpt-5.5' }, true).model).toBe(
      'gpt-5.5',
    );
  });
});

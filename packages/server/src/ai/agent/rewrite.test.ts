import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { runRewrite } from './rewrite.js';

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
const prompt = { instructions: 'Edit the setting.', input: '{"field":"instructions"}' };

describe('runRewrite', () => {
  it('returns the structured text in one call without tools', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [answer(JSON.stringify({ text: 'ROLE\nFormal assistant.' }))],
    });
    const result = await runRewrite({ model, prompt, signal: new AbortController().signal });
    expect(result).toEqual({ text: 'ROLE\nFormal assistant.' });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]!.tools ?? []).toEqual([]);
    const sent = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(sent).toContain('Edit the setting.');
    expect(sent).toContain('{\\"field\\":\\"instructions\\"}');
  });

  it('throws on output outside the format', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer('{"reply":"no"}')] });
    await expect(
      runRewrite({ model, prompt, signal: new AbortController().signal }),
    ).rejects.toThrow();
  });

  it('throws when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV4({ doGenerate: [answer('{"text":"x"}')] });
    await expect(runRewrite({ model, prompt, signal: controller.signal })).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

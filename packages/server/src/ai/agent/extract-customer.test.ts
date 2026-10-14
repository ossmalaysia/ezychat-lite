import { describe, it, expect } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { runCustomerExtraction } from './extract-customer.js';

const answer = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
});
const prompt = {
  instructions: 'Extract self-reported details.',
  input: '{"currentMessage":"Hello"}',
};
describe('customer extraction', () => {
  it('makes one structured call without tools', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer('{"fields":[]}')] });
    expect(
      await runCustomerExtraction({ model, prompt, signal: new AbortController().signal }),
    ).toEqual({ fields: [] });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]!.tools ?? []).toEqual([]);
  });
  it('rejects invalid output', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer('{"reply":"no"}')] });
    await expect(
      runCustomerExtraction({ model, prompt, signal: new AbortController().signal }),
    ).rejects.toThrow();
  });
  it('does not call the model after cancellation', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer('{"fields":[]}')] });
    const cancel = new AbortController();
    cancel.abort();
    await expect(runCustomerExtraction({ model, prompt, signal: cancel.signal })).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

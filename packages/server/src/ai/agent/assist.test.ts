import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { tool } from 'ai';
import { z } from 'zod';
import { ASSIST_MAX_OUTPUT_TOKENS, runAssist } from './assist.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const toolStep = {
  content: [
    {
      type: 'tool-call' as const,
      toolCallId: 'c1',
      toolName: 'get_stats',
      input: JSON.stringify({ days: 7 }),
    },
  ],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
  usage,
  warnings: [],
};
const final = (output: object) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(output) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});
const OUTPUT = {
  text: 'A good week.',
  blocks: [{ type: 'stats', json: '{"items":[{"label":"New","value":"18"}]}' }],
  followUps: ['Why?'],
};

const stats = vi.fn(async () => ({ open: 3 }));
const tools = {
  get_stats: tool({
    description: 'Inbox statistics',
    inputSchema: z.object({ days: z.number() }),
    execute: stats,
  }),
};

describe('runAssist', () => {
  it('runs the read tools, reports each step and returns the structured answer', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [toolStep, final(OUTPUT)] });
    const onStep = vi.fn();
    const result = await runAssist({
      model,
      instructions: 'You are Ezy.',
      messages: [{ role: 'user', content: 'How is my week?' }],
      tools,
      signal: new AbortController().signal,
      onStep,
      reasoningEffort: 'low',
    });
    expect(result).toEqual({ output: OUTPUT, toolCalls: ['get_stats'], steps: 2 });
    expect(stats).toHaveBeenCalledWith({ days: 7 }, expect.anything());
    expect(onStep).toHaveBeenCalledWith(['get_stats']);
    const first = model.doGenerateCalls[0]!;
    expect(first.maxOutputTokens).toBe(ASSIST_MAX_OUTPUT_TOKENS);
    expect(first.providerOptions).toMatchObject({ openai: { reasoningEffort: 'low' } });
    expect(JSON.stringify(first.prompt)).toContain('You are Ezy.');
  });

  it('keeps answering when the step callback throws, and never retries a malformed answer', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [toolStep, final(OUTPUT)] });
    const result = await runAssist({
      model,
      instructions: 'x',
      messages: [{ role: 'user', content: 'q' }],
      tools,
      signal: new AbortController().signal,
      onStep: () => {
        throw new Error('ui gone');
      },
    });
    expect(result.output.text).toBe('A good week.');
    expect(model.doGenerateCalls[0]!.providerOptions?.openai).toBeUndefined();
    const bad = new MockLanguageModelV4({ doGenerate: [final({ reply: 'no' })] });
    await expect(
      runAssist({
        model: bad,
        instructions: 'x',
        messages: [{ role: 'user', content: 'q' }],
        tools: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(bad.doGenerateCalls).toHaveLength(1);
  });

  it('throws before any call when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV4({ doGenerate: [final(OUTPUT)] });
    await expect(
      runAssist({
        model,
        instructions: 'x',
        messages: [{ role: 'user', content: 'q' }],
        tools: {},
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

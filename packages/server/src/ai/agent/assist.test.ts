import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  answerFromText,
  ASSIST_MAX_OUTPUT_TOKENS,
  ASSIST_MAX_STEPS,
  runAssist,
  type AssistCallTrace,
} from './assist.js';

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

  it('forbids tool calls on the last step, so a turn that keeps calling tools still answers', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [...Array.from({ length: ASSIST_MAX_STEPS - 1 }, () => toolStep), final(OUTPUT)],
    });
    const result = await runAssist({
      model,
      instructions: 'x',
      messages: [{ role: 'user', content: 'q' }],
      tools,
      signal: new AbortController().signal,
    });
    expect(result.output).toEqual(OUTPUT);
    expect(result.steps).toBe(ASSIST_MAX_STEPS);
    const calls = model.doGenerateCalls;
    expect(calls.at(-1)!.toolChoice).toEqual({ type: 'none' });
    expect(calls.slice(0, -1).every((c) => c.toolChoice?.type !== 'none')).toBe(true);
  });

  it('takes a complete answer out of extra text after it (a second copy, a closing sentence)', async () => {
    const json = JSON.stringify(OUTPUT);
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep,
        {
          ...final(OUTPUT),
          content: [
            { type: 'text' as const, text: `${json}\n${json.replace('A good week.', 'Copy')}` },
          ],
        },
      ],
    });
    const result = await runAssist({
      model,
      instructions: 'x',
      messages: [{ role: 'user', content: 'q' }],
      tools,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      output: { ...OUTPUT, text: 'Copy' },
      toolCalls: ['get_stats'],
      steps: 2,
      repaired: true,
    });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it.each([
    ['a sentence after the answer', `${JSON.stringify(OUTPUT)} Done!`, OUTPUT],
    ['a sentence before it', `Here it is: ${JSON.stringify(OUTPUT)}`, OUTPUT],
    ['the answer format is wrong', '{"text":"x"} more', null],
    ['no JSON', 'What would you like to improve?', null],
    ['cut short', '{"text":"x","blocks":[', null],
  ])('answerFromText: %s', (_case, text, expected) => {
    expect(answerFromText(text)).toEqual(expected);
  });

  it('still fails when no complete answer is in the text', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          ...final(OUTPUT),
          content: [{ type: 'text' as const, text: '{"text":"x"} and then words' }],
        },
      ],
    });
    await expect(
      runAssist({
        model,
        instructions: 'x',
        messages: [{ role: 'user', content: 'q' }],
        tools: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
  });

  it('traces each model call with counts and times only, and a failing trace changes nothing', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [toolStep, final(OUTPUT)] });
    const traces: AssistCallTrace[] = [];
    const result = await runAssist({
      model,
      instructions: 'x',
      messages: [{ role: 'user', content: 'How is my week, Farah?' }],
      tools,
      signal: new AbortController().signal,
      onTrace: (t) => traces.push(t),
    });
    expect(result.output).toEqual(OUTPUT);
    expect(traces.map((t) => [t.call, t.tools, t.finish])).toEqual([
      [1, ['get_stats'], 'tool-calls'],
      [2, [], 'stop'],
    ]);
    expect(traces[0]).toMatchObject({
      inputMessages: 1,
      inputTokens: 1,
      cachedTokens: 0,
      outputTokens: 1,
    });
    expect(traces[1]!.inputMessages).toBeGreaterThan(1);
    expect(JSON.stringify(traces)).not.toContain('Farah');
    const again = new MockLanguageModelV4({ doGenerate: [final(OUTPUT)] });
    const ok = await runAssist({
      model: again,
      instructions: 'x',
      messages: [{ role: 'user', content: 'q' }],
      tools: {},
      signal: new AbortController().signal,
      onTrace: () => {
        throw new Error('log gone');
      },
    });
    expect(ok.output).toEqual(OUTPUT);
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

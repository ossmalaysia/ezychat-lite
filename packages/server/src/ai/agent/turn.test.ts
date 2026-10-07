import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { runAgentTurn } from './turn.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const toolCall = (query: string) => ({
  content: [
    {
      type: 'tool-call' as const,
      toolCallId: `c-${query}`,
      toolName: 'search_business_context',
      input: JSON.stringify({ query }),
    },
  ],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
  usage,
  warnings: [],
});
const answer = (decision: object) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(decision) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});
const knowledge = [
  { name: 'Hours', text: 'We open 9am to 6pm, Monday to Saturday.' },
  { name: 'Delivery', text: 'Delivery costs RM15, free above RM300.' },
];
const turn = (model: MockLanguageModelV4, signal = new AbortController().signal) => ({
  model,
  prompt: { instructions: 'Answer from business facts.', input: '{"conversation":[]}' },
  knowledge,
  chatJid: '60123456789@s.whatsapp.net',
  signal,
});

describe('runAgentTurn', () => {
  it('searches the business context through a tool, then returns the decision', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall('delivery fee'),
        answer({ reply: 'Delivery is RM15.', action: 'answer', handoffReason: null }),
      ],
    });
    const result = await runAgentTurn(turn(model));
    expect(result.decision).toEqual({
      reply: 'Delivery is RM15.',
      action: 'answer',
      handoffReason: null,
    });
    expect(result.toolCalls).toEqual(['search_business_context']);
    // The tool result reached the model on the second step.
    const second = JSON.stringify(model.doGenerateCalls[1]!.prompt);
    expect(second).toContain('Delivery costs RM15');
  });

  it('never lets the model choose whose data a tool reads: tool inputs carry no chat id', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [answer({ reply: 'Hi', action: 'answer', handoffReason: null })],
    });
    await runAgentTurn(turn(model));
    const tools = model.doGenerateCalls[0]!.tools ?? [];
    expect(tools.map((t) => t.name)).toEqual(['search_business_context']);
    const schema = JSON.stringify(tools.map((t) => ('inputSchema' in t ? t.inputSchema : t)));
    expect(schema).not.toMatch(/chat|jid|phone/i);
  });

  it('stops after four model steps without a decision', async () => {
    const model = new MockLanguageModelV4({ doGenerate: () => Promise.resolve(toolCall('again')) });
    await expect(runAgentTurn(turn(model))).rejects.toThrow();
    expect(model.doGenerateCalls.length).toBeLessThanOrEqual(4);
  });

  it('throws when the reply is cancelled (never ends quietly)', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV4({
      doGenerate: [answer({ reply: 'Hi', action: 'answer', handoffReason: null })],
    });
    await expect(runAgentTurn(turn(model, controller.signal))).rejects.toThrow();
  });

  it('rejects an answer outside the decision format', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [answer({ reply: 'Hi', action: 'refund_everything', handoffReason: null })],
    });
    await expect(runAgentTurn(turn(model))).rejects.toThrow();
  });
});

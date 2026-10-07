import { describe, expect, it } from 'vitest';
import { BackendError, collectResponse, parseSse } from '../chatgpt-backend.js';
import { AI_FULL_CONTEXT_CHARACTERS } from '../knowledge.js';
import { chatGptModel, codexRequestBody } from './models.js';
import { chatTools } from './tools.js';
import { runAgentTurn } from './turn.js';

/** A ChatGPT event stream, as the backend sends it (items one by one, then completed). */
const stream = (items: object[]) =>
  new Response(
    [
      ...items.map((item) => ({ type: 'response.output_item.done', item })),
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          object: 'response',
          created_at: 1,
          model: 'gpt-test',
          status: 'completed',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } },
        },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
  ).body!;
const decisionMessage = (decision: object) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', annotations: [], text: JSON.stringify(decision) }],
});
const bigKnowledge = [
  { name: 'Delivery', text: 'Delivery costs RM15.' },
  { name: 'Catalogue', text: 'x'.repeat(AI_FULL_CONTEXT_CHARACTERS) },
];

describe('ChatGPT sign-in model (AI SDK)', () => {
  it('turns an SDK request into a streamed, store-less Codex request', () => {
    const body = codexRequestBody(
      {
        model: 'gpt-test',
        input: [
          { role: 'developer', content: 'Rules' },
          { role: 'user', content: 'Hi' },
        ],
        max_output_tokens: 2000,
        temperature: 0.2,
        metadata: { a: 1 },
        store: true,
      },
      'ezychat-key',
    );
    expect(body).toMatchObject({ stream: true, store: false, instructions: 'Rules' });
    expect(body.input).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(body).not.toHaveProperty('max_output_tokens');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('metadata');
    expect(body.prompt_cache_key).toBe('ezychat-key');
  });

  it('runs a tool call and a structured decision over the event stream', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const replies = [
      stream([
        // The model may reason before the tool call; with store:false that item must be resent in
        // full on the next step (a reference to its id is a 404 on the ChatGPT backend).
        { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-reasoning' },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'search_business_context',
          arguments: JSON.stringify({ query: 'delivery' }),
          status: 'completed',
        },
      ]),
      stream([
        decisionMessage({ reply: 'Delivery is RM15.', action: 'answer', handoffReason: null }),
      ]),
    ];
    const model = chatGptModel({
      modelId: 'gpt-test',
      cacheKey: 'ezychat-key',
      send: async (body) => {
        sent.push(body);
        return collectResponse(parseSse(replies.shift()!));
      },
    });
    const result = await runAgentTurn({
      model,
      prompt: { instructions: 'Answer from business facts.', input: '{"conversation":[]}' },
      tools: chatTools({ knowledge: bigKnowledge }),
      signal: new AbortController().signal,
    });
    expect(result.decision).toEqual({
      reply: 'Delivery is RM15.',
      action: 'answer',
      handoffReason: null,
    });
    expect(result.toolCalls).toEqual(['search_business_context']);
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body).toMatchObject({ stream: true, store: false, prompt_cache_key: 'ezychat-key' });
      expect(body.instructions).toContain('Answer from business facts.');
      expect(body.include).toContain('reasoning.encrypted_content');
    }
    const second = JSON.stringify(sent[1]!.input);
    // The tool's result went back to the model, and the reasoning was resent, never referenced.
    expect(second).toContain('Delivery costs RM15.');
    expect(second).toContain('opaque-reasoning');
    expect(second).not.toContain('item_reference');
  });

  it("reports the client's fixed error message, never upstream text", async () => {
    const model = chatGptModel({
      modelId: 'gpt-test',
      send: async () => {
        throw new BackendError('ChatGPT usage limit reached. Try again later.', 429);
      },
    });
    const run = runAgentTurn({
      model,
      prompt: { instructions: 'x', input: 'y' },
      signal: new AbortController().signal,
    });
    await expect(run).rejects.toThrow('ChatGPT usage limit reached. Try again later.');
  });
});

import { describe, expect, it } from 'vitest';
import { chatGptModel, codexRequestBody } from './models.js';
import { runAgentTurn } from './turn.js';

const sse = (events: object[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const completed = (output: object[]) => ({
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
  _items: output,
});
// The Codex stream reports items one by one; `response.completed` may carry an empty output.
const streamOf = (items: object[]) =>
  sse([
    ...items.map((item) => ({ type: 'response.output_item.done', item })),
    (({ _items, ...event }) => event)(completed(items)),
  ]);

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

  it('runs a tool call and a structured decision over the streamed backend', async () => {
    const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
    const replies = [
      streamOf([
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
      streamOf([
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              annotations: [],
              text: JSON.stringify({
                reply: 'Delivery is RM15.',
                action: 'answer',
                handoffReason: null,
              }),
            },
          ],
        },
      ]),
    ];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return replies.shift()!;
    }) as typeof fetch;
    const model = chatGptModel({
      modelId: 'gpt-test',
      auth: async () => ({ accessToken: 'token-123', accountId: 'acct-1' }),
      cacheKey: 'ezychat-key',
      fetch: fetchImpl,
    });
    const result = await runAgentTurn({
      model,
      prompt: { instructions: 'Answer from business facts.', input: '{"conversation":[]}' },
      knowledge: [{ name: 'Delivery', text: 'Delivery costs RM15.' }],
      chatJid: '60123@s.whatsapp.net',
      signal: new AbortController().signal,
    });
    expect(result.decision).toEqual({
      reply: 'Delivery is RM15.',
      action: 'answer',
      handoffReason: null,
    });
    expect(result.toolCalls).toEqual(['search_business_context']);
    expect(requests).toHaveLength(2);
    for (const { headers, body } of requests) {
      expect(headers.get('authorization')).toBe('Bearer token-123');
      expect(headers.get('chatgpt-account-id')).toBe('acct-1');
      expect(body).toMatchObject({ stream: true, store: false });
      expect(body.instructions).toContain('Answer from business facts.');
    }
    // The tool's result went back to the model in the second request.
    expect(JSON.stringify(requests[1]!.body.input)).toContain('Delivery costs RM15.');
    // Nothing is stored server-side, so earlier items are resent in full, never referenced.
    expect(JSON.stringify(requests[1]!.body.input)).not.toContain('item_reference');
    expect(JSON.stringify(requests[1]!.body.input)).toContain('opaque-reasoning');
  });

  it('reports a backend error without the response body', async () => {
    const fetchImpl = (async () =>
      new Response('secret upstream text', { status: 401 })) as typeof fetch;
    const model = chatGptModel({
      modelId: 'gpt-test',
      auth: async () => ({ accessToken: 't', accountId: 'a' }),
      fetch: fetchImpl,
    });
    const run = runAgentTurn({
      model,
      prompt: { instructions: 'x', input: 'y' },
      knowledge: [],
      chatJid: 'c',
      signal: new AbortController().signal,
    });
    await expect(run).rejects.toThrow();
    await expect(run).rejects.not.toThrow(/secret upstream text/);
  });
});

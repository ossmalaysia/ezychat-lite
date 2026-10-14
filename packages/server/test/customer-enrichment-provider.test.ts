import { afterEach, expect, it, vi } from 'vitest';
import { DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import { extractCustomerOpenAi } from '../src/ai/provider.js';
import { CODEX_BACKEND } from '../src/ai/chatgpt-backend.js';
import { answerText, CHATGPT_SETTINGS, seedTokens } from './chatgpt-fixtures.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.unstubAllGlobals();
});
const prompt = {
  instructions: 'Extract customer facts.',
  input: '{"currentMessage":"Hello"}',
  cacheId: 'random-install',
};
it('uses the shared ChatGPT sign-in for one tool-free structured extraction', async () => {
  t = await makeTestApp();
  seedTokens(t.ctx);
  const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => answerText('{"fields":[]}'));
  const provider = new DirectChatGptProvider(t.ctx, { fetch: fetcher as typeof fetch });
  try {
    expect(
      await provider.extractCustomer(
        { ...CHATGPT_SETTINGS, model: 'gpt-6-astra' },
        null,
        prompt,
        new AbortController().signal,
      ),
    ).toEqual({ fields: [] });
    const calls = fetcher.mock.calls.filter(([url]) => url === CODEX_BACKEND.responsesUrl);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]![1]!.body));
    expect(body.instructions).toBe(prompt.instructions);
    expect(body.tools ?? []).toEqual([]);
    expect(body.store).toBe(false);
  } finally {
    await provider.shutdown();
  }
});
it('uses API-key mode with the same Responses safeguards', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: 'resp_1',
          object: 'response',
          created_at: 1,
          model: 'gpt-4.1-mini',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg_1',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: '{"fields":[]}', annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(
    await extractCustomerOpenAi(
      { ...CHATGPT_SETTINGS, mode: 'api', model: '' },
      'sk-test',
      prompt,
      new AbortController().signal,
    ),
  ).toEqual({ fields: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const call = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
  const body = JSON.parse(String(call[1].body));
  expect(body.store).toBe(false);
  expect(body.include).toContain('reasoning.encrypted_content');
  expect(body.tools ?? []).toEqual([]);
});

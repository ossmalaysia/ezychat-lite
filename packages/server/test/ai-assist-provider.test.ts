import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODEX_BACKEND } from '../src/ai/chatgpt-backend.js';
import { DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import { assistOpenAi } from '../src/ai/provider.js';
import { assistClaude } from '../src/ai/claude.js';
import { answerText, CHATGPT_SETTINGS, seedTokens } from './chatgpt-fixtures.js';
import { makeTestApp, type TestApp } from './helpers.js';

const OUTPUT = { text: 'A good week.', blocks: [], followUps: [] };
const call = {
  instructions: 'You are Ezy.',
  messages: [{ role: 'user' as const, content: 'Hi' }],
  tools: {},
};

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await t.close();
});

const openAiAnswer = (text: string) =>
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
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );

describe('provider assist (network mocked, no real model)', () => {
  it('API key mode needs a key, then answers with the saved model', async () => {
    const settings = { ...CHATGPT_SETTINGS, mode: 'api' as const, model: 'gpt-5.5' };
    await expect(assistOpenAi(settings, null, call, new AbortController().signal)).rejects.toThrow(
      'Add an OpenAI API key',
    );
    const fetcher = vi.fn(async () => openAiAnswer(JSON.stringify(OUTPUT)));
    vi.stubGlobal('fetch', fetcher);
    const result = await assistOpenAi(settings, 'sk-test', call, new AbortController().signal);
    expect(result).toMatchObject({ output: OUTPUT, model: 'gpt-5.5', toolCalls: [] });
    const init = (fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect(JSON.parse(String(init.body)).model).toBe('gpt-5.5');
  });

  it('Claude key mode needs a key', async () => {
    const settings = { ...CHATGPT_SETTINGS, mode: 'claude' as const, model: '' };
    await expect(assistClaude(settings, null, call, new AbortController().signal)).rejects.toThrow(
      'Add a Claude API key',
    );
  });

  it('ChatGPT sign-in: one turn on the fast model (not the saved one) with reasoning low; key modes delegate', async () => {
    seedTokens(t.ctx);
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).startsWith(CODEX_BACKEND.modelsUrl)
        ? new Response(JSON.stringify({ models: [] }))
        : answerText(JSON.stringify(OUTPUT)),
    );
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const result = await provider.assist(
      { ...CHATGPT_SETTINGS, model: 'gpt-6-astra' },
      null,
      call,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ output: OUTPUT, model: 'gpt-6-luna' });
    const sent = fetchMock.mock.calls.filter((c) => c[0] === CODEX_BACKEND.responsesUrl);
    expect(sent).toHaveLength(1);
    const body = JSON.parse(String((sent[0] as unknown as [unknown, RequestInit])[1].body));
    expect(body.reasoning).toMatchObject({ effort: 'low' });
    expect(body.store).toBe(false);
    await expect(
      provider.assist(
        { ...CHATGPT_SETTINGS, mode: 'api', model: '' },
        null,
        call,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Add an OpenAI API key');
    await expect(
      provider.assist(
        { ...CHATGPT_SETTINGS, mode: 'claude', model: '' },
        null,
        call,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Add a Claude API key');
    await provider.shutdown();
  });
});

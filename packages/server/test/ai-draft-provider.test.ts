import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CODEX_BACKEND } from '../src/ai/chatgpt-backend.js';
import { DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import { draftOpenAi } from '../src/ai/provider.js';
import { answerText, CHATGPT_SETTINGS, seedTokens } from './chatgpt-fixtures.js';
import { makeTestApp, type TestApp } from './helpers.js';

const Schema = z.object({ completion: z.string().nullable(), grounded: z.boolean() });
const prompt = { instructions: 'Write drafts.', input: '{"conversation":[]}' };
const OUTPUT = { completion: 'Lemak Ayam is RM12.', grounded: true };

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

describe('provider draft (network mocked)', () => {
  it('API key mode: a completion uses the small default model, not the saved one', async () => {
    const settings = { ...CHATGPT_SETTINGS, mode: 'api' as const, model: 'gpt-5.5' };
    const options = { schema: Schema, fast: true, maxOutputTokens: 300 };
    await expect(
      draftOpenAi(settings, null, prompt, options, new AbortController().signal),
    ).rejects.toThrow('Add an OpenAI API key');
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      openAiAnswer(JSON.stringify(OUTPUT)),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(
      await draftOpenAi(settings, 'sk-test', prompt, options, new AbortController().signal),
    ).toEqual({ output: OUTPUT, model: 'gpt-4.1-mini' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).model).toBe('gpt-4.1-mini');
  });

  /** One ChatGPT draft call; returns the result and the one Codex request body it sent. */
  const chatGptDraft = async (fast: boolean, liveIds?: string[]) => {
    seedTokens(t.ctx);
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).startsWith(CODEX_BACKEND.modelsUrl)
        ? new Response(
            JSON.stringify({
              models: (liveIds ?? []).map((slug, priority) => ({
                slug,
                visibility: 'list',
                priority,
              })),
            }),
          )
        : answerText(JSON.stringify(OUTPUT)),
    );
    const real = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    if (liveIds) expect((await real.models()).source).toBe('live');
    const result = await real.draft(
      { ...CHATGPT_SETTINGS, model: 'gpt-6-astra' },
      null,
      prompt,
      { schema: Schema, fast, maxOutputTokens: 300 },
      new AbortController().signal,
    );
    const calls = fetchMock.mock.calls.filter((c) => c[0] === CODEX_BACKEND.responsesUrl);
    expect(calls).toHaveLength(1);
    await real.shutdown();
    return { result, sent: JSON.parse(String(calls[0]![1]!.body)) };
  };

  it('ChatGPT mode: a completion is one tool-free request on the fast model, reasoning low', async () => {
    const { result, sent } = await chatGptDraft(true);
    expect(result).toEqual({ output: OUTPUT, model: 'gpt-6-luna' });
    expect(sent.model).toBe('gpt-6-luna');
    expect(sent.reasoning).toMatchObject({ effort: 'low' });
    expect(sent.store).toBe(false);
    expect(sent.instructions).toBe('Write drafts.');
    expect(sent.tools ?? []).toEqual([]);
  });

  it('ChatGPT mode: without fast the saved model answers, also with reasoning low', async () => {
    const { result, sent } = await chatGptDraft(false);
    expect(result.model).toBe('gpt-6-astra');
    expect(sent.reasoning).toMatchObject({ effort: 'low' });
  });

  it('ChatGPT mode: an account without a fast model completes with the saved model', async () => {
    expect((await chatGptDraft(true, ['gpt-6-astra', 'gpt-6.1-sol'])).result.model).toBe(
      'gpt-6-astra',
    );
    expect((await chatGptDraft(true, ['gpt-6-astra', 'gpt-5.6-luna'])).result.model).toBe(
      'gpt-5.6-luna',
    );
  });

  it('dispatches API key and Claude modes to their own clients', async () => {
    const real = new DirectChatGptProvider(t.ctx);
    const options = { schema: Schema, fast: false, maxOutputTokens: 2000 };
    await expect(
      real.draft(
        { ...CHATGPT_SETTINGS, mode: 'api' },
        null,
        prompt,
        options,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Add an OpenAI API key');
    await expect(
      real.draft(
        { ...CHATGPT_SETTINGS, mode: 'claude' },
        null,
        prompt,
        options,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Add a Claude API key');
    await real.shutdown();
  });
});

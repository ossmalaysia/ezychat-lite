import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CODEX_BACKEND } from '../src/ai/chatgpt-backend.js';
import { DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import { assistOpenAi, draftOpenAi, generateOpenAi, rewriteOpenAi } from '../src/ai/provider.js';
import { assistClaude, generateClaude, rewriteClaude } from '../src/ai/claude.js';
import { answerText, CHATGPT_SETTINGS, seedTokens } from './chatgpt-fixtures.js';
import { makeTestApp, type TestApp } from './helpers.js';

/**
 * AI models per task (docs/ai-models.md): a row's "Speed and quality" level reaches ChatGPT always, an OpenAI key
 * only for reasoning models, Claude never. Network mocked; no real model is called.
 */
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
      model: 'x',
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
const bodyOf = (call: unknown) => JSON.parse(String((call as [unknown, RequestInit])[1].body));
const signal = () => new AbortController().signal;
const DECISION = JSON.stringify({ reply: 'Hi', action: 'answer', handoffReason: null });

describe('OpenAI key: the level goes only to reasoning models', () => {
  const api = (model: string) => ({ ...CHATGPT_SETTINGS, mode: 'api' as const, model });
  const prompt = { instructions: 'x', input: '{}', reasoningEffort: 'high' as const };

  it('agent turn, draft, rewrite and Ask Ezy on gpt-5.5 send it', async () => {
    const fetcher = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const text = JSON.stringify(body.text?.format?.schema?.properties ?? {});
      return openAiAnswer(
        text.includes('handoffReason')
          ? DECISION
          : text.includes('followUps')
            ? JSON.stringify({ text: 'ok', blocks: [], followUps: [] })
            : text.includes('"text"')
              ? JSON.stringify({ text: 'New text' })
              : JSON.stringify({ ok: true }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    await generateOpenAi(api('gpt-5.5'), 'sk-test', prompt, signal());
    await draftOpenAi(
      api('gpt-5.5'),
      'sk-test',
      prompt,
      { schema: z.object({ ok: z.boolean() }), fast: false, maxOutputTokens: 100 },
      signal(),
    );
    await rewriteOpenAi(api('gpt-5.5'), 'sk-test', prompt, signal());
    await assistOpenAi(
      api('gpt-5.5'),
      'sk-test',
      {
        instructions: 'x',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: {},
        reasoningEffort: 'high',
      },
      signal(),
    );
    expect(fetcher.mock.calls.map((c) => bodyOf(c).reasoning?.effort)).toEqual([
      'high',
      'high',
      'high',
      'high',
    ]);
  });

  it('gpt-4.1 gets no level', async () => {
    const fetcher = vi.fn(async () => openAiAnswer(DECISION));
    vi.stubGlobal('fetch', fetcher);
    await generateOpenAi(api('gpt-4.1'), 'sk-test', prompt, signal());
    expect(bodyOf(fetcher.mock.calls[0]).reasoning).toBeUndefined();
  });
});

describe('ChatGPT sign-in: the level is always sent', () => {
  const chatgpt = () => {
    seedTokens(t.ctx);
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).startsWith(CODEX_BACKEND.modelsUrl))
        return new Response(
          JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list', priority: 0 }] }),
        );
      const body = JSON.parse(String(init?.body));
      const schema = JSON.stringify(body.text?.format?.schema?.properties ?? {});
      return answerText(
        schema.includes('followUps')
          ? JSON.stringify({ text: 'ok', blocks: [], followUps: [] })
          : JSON.stringify({ ok: true }),
      );
    });
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const sent = () =>
      fetchMock.mock.calls
        .filter((c) => c[0] === CODEX_BACKEND.responsesUrl)
        .map((c) => bodyOf(c).reasoning?.effort);
    return { provider, sent };
  };

  it('a draft takes the row level (else low), Ask Ezy on a named model takes it too', async () => {
    const { provider, sent } = chatgpt();
    const options = { schema: z.object({ ok: z.boolean() }), fast: false, maxOutputTokens: 100 };
    const settings = { ...CHATGPT_SETTINGS, model: 'gpt-6-astra' };
    await provider.draft(
      settings,
      null,
      { instructions: 'x', input: '{}', reasoningEffort: 'high' },
      options,
      signal(),
    );
    await provider.draft(settings, null, { instructions: 'x', input: '{}' }, options, signal());
    const call = {
      instructions: 'x',
      messages: [{ role: 'user' as const, content: 'Hi' }],
      tools: {},
    };
    await provider.assist(
      settings,
      null,
      { ...call, main: true, reasoningEffort: 'medium' },
      signal(),
    );
    await provider.assist(settings, null, { ...call, main: true }, signal());
    expect(sent()).toEqual(['high', 'low', 'medium', undefined]);
    // The live list is read only on request; until then the AI models rows keep saved ids. Once read it stays the
    // list (also after the cache time) until sign-out.
    expect(provider.modelListRead()).toBe(false);
    await provider.models();
    expect(provider.modelListRead()).toBe(true);
    await provider.shutdown();
  });
});

describe('Claude key: no level reaches Claude (phase 2)', () => {
  it('agent turn, rewrite and Ask Ezy drop it before the request', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetcher);
    const settings = { ...CHATGPT_SETTINGS, mode: 'claude' as const, model: '' };
    const prompt = { instructions: 'x', input: '{}', reasoningEffort: 'high' as const };
    await expect(generateClaude(settings, 'sk-ant-test', prompt, signal())).rejects.toThrow();
    await expect(rewriteClaude(settings, 'sk-ant-test', prompt, signal())).rejects.toThrow();
    await expect(
      assistClaude(
        settings,
        'sk-ant-test',
        {
          instructions: 'x',
          messages: [{ role: 'user', content: 'Hi' }],
          tools: {},
          reasoningEffort: 'high',
        },
        signal(),
      ),
    ).rejects.toThrow();
    for (const c of fetcher.mock.calls) {
      const body = bodyOf(c);
      expect(body.thinking).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('reasoning');
    }
    expect(fetcher).toHaveBeenCalled();
  });
});

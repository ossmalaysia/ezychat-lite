import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CODEX_BACKEND } from '../src/ai/chatgpt-backend.js';
import { DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import {
  assistOpenAi,
  draftOpenAi,
  generateOpenAi,
  openAiModelReasons,
  rewriteOpenAi,
} from '../src/ai/provider.js';
import { AGENT_TURN_MAX_OUTPUT_TOKENS } from '../src/ai/agent/turn.js';
import { ASSIST_MAX_OUTPUT_TOKENS } from '../src/ai/agent/assist.js';
import { REWRITE_MAX_OUTPUT_TOKENS } from '../src/ai/agent/rewrite.js';
import { assistClaude, generateClaude, rewriteClaude } from '../src/ai/claude.js';
import { REASONING_HEADROOM } from '../src/ai/agent/draft.js';
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
    // Every answer cap gets the Smarter reasoning headroom, or the reasoning would use it up: the agent turn's
    // decision, the draft, Ask Ezy.
    expect(bodyOf(fetcher.mock.calls[0]).max_output_tokens).toBe(
      AGENT_TURN_MAX_OUTPUT_TOKENS + REASONING_HEADROOM.high,
    );
    expect(bodyOf(fetcher.mock.calls[1]).max_output_tokens).toBe(100 + REASONING_HEADROOM.high);
    expect(bodyOf(fetcher.mock.calls[2]).max_output_tokens).toBe(
      REWRITE_MAX_OUTPUT_TOKENS + REASONING_HEADROOM.high,
    );
    expect(bodyOf(fetcher.mock.calls[3]).max_output_tokens).toBe(
      ASSIST_MAX_OUTPUT_TOKENS + REASONING_HEADROOM.high,
    );
  });

  it('gpt-4.1 gets no level and a draft keeps its own small cap', async () => {
    const fetcher = vi.fn(async () => openAiAnswer(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetcher);
    await generateOpenAi(api('gpt-4.1'), 'sk-test', prompt, signal()).catch(() => undefined);
    expect(bodyOf(fetcher.mock.calls[0]).reasoning).toBeUndefined();
    await draftOpenAi(
      api('gpt-4.1'),
      'sk-test',
      prompt,
      { schema: z.object({ ok: z.boolean() }), fast: false, maxOutputTokens: 300 },
      signal(),
    );
    expect(bodyOf(fetcher.mock.calls.at(-1)).max_output_tokens).toBe(300);
    // A reasoning model at its own level (nothing sent) still reasons: Balanced headroom.
    await draftOpenAi(
      api('gpt-5.5'),
      'sk-test',
      { instructions: 'x', input: '{}' },
      { schema: z.object({ ok: z.boolean() }), fast: false, maxOutputTokens: 300 },
      signal(),
    );
    expect(bodyOf(fetcher.mock.calls.at(-1)).max_output_tokens).toBe(
      300 + REASONING_HEADROOM.medium,
    );
    // o1-mini and the -pro models take no level of ours but still reason: headroom at their own level.
    for (const id of ['o1-mini', 'gpt-5-pro']) {
      await draftOpenAi(
        api(id),
        'sk-test',
        prompt,
        { schema: z.object({ ok: z.boolean() }), fast: false, maxOutputTokens: 300 },
        signal(),
      );
      const body = bodyOf(fetcher.mock.calls.at(-1));
      expect(body.reasoning?.effort).toBeUndefined();
      expect(body.max_output_tokens).toBe(300 + REASONING_HEADROOM.medium);
    }
    expect(openAiModelReasons('gpt-5-chat-latest')).toBe(false);
    // gpt-4.1's agent turn keeps its own cap.
    await generateOpenAi(api('gpt-4.1'), 'sk-test', prompt, signal()).catch(() => undefined);
    const turn = fetcher.mock.calls.findLast((c) => bodyOf(c).model === 'gpt-4.1');
    expect(bodyOf(turn).max_output_tokens).toBe(AGENT_TURN_MAX_OUTPUT_TOKENS);
    // …and Edit with AI and Ask Ezy keep theirs.
    await rewriteOpenAi(api('gpt-4.1'), 'sk-test', prompt, signal()).catch(() => undefined);
    expect(bodyOf(fetcher.mock.calls.at(-1)).max_output_tokens).toBe(REWRITE_MAX_OUTPUT_TOKENS);
    await assistOpenAi(
      api('gpt-4.1'),
      'sk-test',
      { instructions: 'x', messages: [{ role: 'user', content: 'Hi' }], tools: {} },
      signal(),
    ).catch(() => undefined);
    expect(bodyOf(fetcher.mock.calls.at(-1)).max_output_tokens).toBe(ASSIST_MAX_OUTPUT_TOKENS);
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
    const caps = () =>
      fetchMock.mock.calls
        .filter((c) => c[0] === CODEX_BACKEND.responsesUrl)
        .map((c) => bodyOf(c).max_output_tokens);
    return { provider, sent, caps };
  };

  it('a draft takes the row level (else low), Ask Ezy on a named model takes it too', async () => {
    const { provider, sent, caps } = chatgpt();
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
    // The ChatGPT backend takes no output cap, so reasoning can never use one up.
    expect(caps().slice(0, 2)).toEqual([undefined, undefined]);
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

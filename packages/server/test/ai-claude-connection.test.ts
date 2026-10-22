import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { CLAUDE_DEFAULT_MODEL, CLAUDE_MODELS } from '@ezychat/shared';
import {
  AI_CLAUDE_SECRET_KEY,
  AI_PROVIDER_KEY,
  AI_SECRET_KEY,
  aiApiKey,
  claudeApiKey,
  openAiApiKey,
} from '../src/ai/settings-keys.js';
import {
  ANTHROPIC_MODELS_URL,
  createAiKeyTester,
  OPENAI_MODELS_URL,
  testClaudeKey,
} from '../src/ai/key-test.js';
import { DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import { createAiService } from '../src/ai/service.js';
import type { AiProvider } from '../src/ai/provider-types.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const OPENAI_KEY = 'sk-openai-SECRET-0123456789';
const CLAUDE_KEY = 'sk-ant-api03-SECRET-0123456789';

function capture() {
  const lines: string[] = [];
  const log = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) });
  return { lines, log };
}
const reply = (status: number) => vi.fn(async () => new Response('{}', { status }));

describe('testClaudeKey', () => {
  it('lists Anthropic models with the key and API version headers', async () => {
    const { log } = capture();
    const fetchMock = reply(200);
    expect(await testClaudeKey(CLAUDE_KEY, { log, fetch: fetchMock as never })).toEqual({
      ok: true,
      error: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_MODELS_URL);
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(CLAUDE_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers.authorization).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, 'invalid_key'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [529, 'unreachable'],
    [500, 'unreachable'],
  ] as const)('maps HTTP %i to %s', async (status, error) => {
    const { log } = capture();
    expect(await testClaudeKey(CLAUDE_KEY, { log, fetch: reply(status) as never })).toEqual({
      ok: false,
      error,
    });
  });

  it('reports a network failure as unreachable and never logs the key', async () => {
    const { lines, log } = capture();
    const result = await testClaudeKey(CLAUDE_KEY, {
      log,
      fetch: vi.fn(async () => {
        throw new TypeError(`fetch failed ${CLAUDE_KEY}`);
      }) as never,
    });
    expect(result).toEqual({ ok: false, error: 'unreachable' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      mod: 'ai',
      event: 'ai_key_test',
      provider: 'claude',
      ok: false,
      error: 'unreachable',
      msg: 'Claude API key tested',
    });
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  it('is chosen by the tester for the claude mode; OpenAI stays the default', async () => {
    const { log } = capture();
    const fetchMock = reply(200);
    const tester = createAiKeyTester({ log, fetch: fetchMock as never });
    await tester(OPENAI_KEY);
    await tester(CLAUDE_KEY, 'claude');
    await tester(OPENAI_KEY, 'api');
    const urls = fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([OPENAI_MODELS_URL, ANTHROPIC_MODELS_URL, OPENAI_MODELS_URL]);
  });
});

describe('Claude API key connection', { timeout: 30_000 }, () => {
  let t: TestApp;
  let cookie: string;
  let adminId: number;
  let provider: AiProvider;
  let keyFetch: ReturnType<typeof vi.fn>;
  let keyStatus: number;
  let logLines: string[];

  beforeEach(async () => {
    keyStatus = 200;
    keyFetch = vi.fn(async () => new Response('{}', { status: keyStatus }));
    logLines = [];
    provider = {
      generate: vi.fn(),
      extractCustomer: vi.fn(async () => ({ fields: [] })),
      rewrite: vi.fn(async () => ({ text: 'Formal', model: CLAUDE_DEFAULT_MODEL })),
      connection: () => ({ state: 'signed_out', loginUrl: null, error: null }),
      login: vi.fn(),
      logout: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      models: vi.fn(async () => ({ models: [], source: 'live' as const })),
    };
    t = await makeTestApp({
      beforeBuild: async (ctx) => {
        await ctx.services.ai!.shutdown();
        const log = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
        ctx.services.aiKeyTest = createAiKeyTester({ log, fetch: keyFetch as never });
        ctx.services.ai = createAiService(ctx, { provider });
      },
    });
    const auth = t.ctx.services.auth!;
    const admin = auth.createUser({
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      password: 'password123',
      mustChangePassword: false,
    });
    adminId = admin.id;
    cookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.close();
  });

  const save = (payload: object) =>
    t.app.inject({
      method: 'PATCH',
      url: '/api/ai/connection',
      headers: authHeaders(cookie),
      payload,
    });
  const status = async () =>
    (await t.app.inject({ method: 'GET', url: '/api/ai', headers: authHeaders(cookie) })).json();

  it('keeps both saved keys when switching OpenAI → Claude → OpenAI and uses the right one', async () => {
    expect((await save({ mode: 'api', model: '', apiKey: OPENAI_KEY })).statusCode).toBe(200);
    let body = await status();
    expect(body).toMatchObject({ hasApiKey: true, hasClaudeApiKey: false });

    const saved = await save({ mode: 'claude', model: '', apiKey: CLAUDE_KEY });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('SECRET');
    expect(t.ctx.settings.getSecret(AI_SECRET_KEY)).toBe(OPENAI_KEY);
    expect(t.ctx.settings.getSecret(AI_CLAUDE_SECRET_KEY)).toBe(CLAUDE_KEY);
    body = await status();
    expect(body).toMatchObject({
      hasApiKey: true,
      hasClaudeApiKey: true,
      settings: { mode: 'claude', model: '' },
      connection: { state: 'connected', loginUrl: null, error: null },
    });
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(claudeApiKey(t.ctx.settings)).toBe(CLAUDE_KEY);
    expect(aiApiKey(t.ctx.settings)).toBe(CLAUDE_KEY);
    // Cloud voice reads only the OpenAI key in OpenAI mode: off with Claude.
    expect(openAiApiKey(t.ctx.settings)).toBeNull();

    // The Claude key reaches the provider in Claude mode.
    expect(t.ctx.services.ai!.connectionReady()).toBe(true);
    await t.ctx.services.ai!.extractCustomer(
      { instructions: 'x', input: '{}' },
      new AbortController().signal,
    );
    expect(vi.mocked(provider.extractCustomer!).mock.calls.at(-1)![1]).toBe(CLAUDE_KEY);
    const edit = await t.app.inject({
      method: 'POST',
      url: '/api/ai/edit',
      headers: authHeaders(cookie),
      payload: { field: 'instructions', current: 'Be nice', request: 'More formal' },
    });
    expect(edit.statusCode).toBe(200);
    expect(vi.mocked(provider.rewrite!).mock.calls.at(-1)![1]).toBe(CLAUDE_KEY);

    // Back to OpenAI without a new key: both stay, the OpenAI key is used.
    expect((await save({ mode: 'api', model: '' })).statusCode).toBe(200);
    expect(t.ctx.settings.getSecret(AI_SECRET_KEY)).toBe(OPENAI_KEY);
    expect(t.ctx.settings.getSecret(AI_CLAUDE_SECRET_KEY)).toBe(CLAUDE_KEY);
    expect(await status()).toMatchObject({ hasApiKey: true, hasClaudeApiKey: true });
    expect(claudeApiKey(t.ctx.settings)).toBeNull();
    expect(aiApiKey(t.ctx.settings)).toBe(OPENAI_KEY);
    expect(openAiApiKey(t.ctx.settings)).toBe(OPENAI_KEY);
    await t.ctx.services.ai!.extractCustomer(
      { instructions: 'x', input: '{}' },
      new AbortController().signal,
    );
    expect(vi.mocked(provider.extractCustomer!).mock.calls.at(-1)![1]).toBe(OPENAI_KEY);
  });

  it('is signed out in Claude mode until a Claude key is saved', async () => {
    expect((await save({ mode: 'api', model: '', apiKey: OPENAI_KEY })).statusCode).toBe(200);
    expect((await save({ mode: 'claude', model: '' })).statusCode).toBe(200);
    expect((await status()).connection.state).toBe('signed_out');
    expect(t.ctx.services.ai!.connectionReady()).toBe(false);
    expect(aiApiKey(t.ctx.settings)).toBeNull();
    // A Claude key saved later, with a listed model.
    expect(
      (await save({ mode: 'claude', model: 'claude-opus-5-5', apiKey: CLAUDE_KEY })).statusCode,
    ).toBe(200);
    expect(t.ctx.settings.get(AI_PROVIDER_KEY, null)).toEqual({
      mode: 'claude',
      model: 'claude-opus-5-5',
    });
    expect((await status()).connection.state).toBe('connected');
  });

  it('rejects a model that is not a Claude model', async () => {
    const res = await save({ mode: 'claude', model: 'gpt-4.1-mini', apiKey: CLAUDE_KEY });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('SECRET');
    expect(t.ctx.settings.getSecret(AI_CLAUDE_SECRET_KEY)).toBeNull();
  });

  it('lists the three Claude models without a network call', async () => {
    const outside = vi.spyOn(globalThis, 'fetch');
    await save({ mode: 'claude', model: '', apiKey: CLAUDE_KEY });
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/ai/models',
      headers: authHeaders(cookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      models: [
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      ],
      source: 'fallback',
    });
    expect(res.json().models.map((m: { id: string }) => m.id)).toEqual([...CLAUDE_MODELS]);
    expect(provider.models).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
  });

  it('tests a Claude key on request without saving it', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/ai/connection/test',
      headers: authHeaders(cookie),
      payload: { mode: 'claude', apiKey: CLAUDE_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, error: null });
    const [url, init] = keyFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_MODELS_URL);
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(CLAUDE_KEY);
    expect(t.ctx.settings.getSecret(AI_CLAUDE_SECRET_KEY)).toBeNull();
    expect(logLines.join('\n')).not.toContain('SECRET');

    keyStatus = 401;
    const rejected = await t.app.inject({
      method: 'POST',
      url: '/api/ai/connection/test',
      headers: authHeaders(cookie),
      payload: { mode: 'claude', apiKey: CLAUDE_KEY },
    });
    expect(rejected.json()).toEqual({ ok: false, error: 'invalid_key' });
  });

  it('answers Try it with the Claude key and shows the Claude model', async () => {
    vi.mocked(provider.generate).mockResolvedValue({
      reply: 'RM10',
      action: 'answer',
      handoffReason: null,
    });
    await save({ mode: 'claude', model: 'claude-haiku-5-5', apiKey: CLAUDE_KEY });
    const actor = { userId: adminId, ip: null };
    t.ctx.services.ai!.saveMember(
      { displayName: 'Agent', enabled: false, instructions: '' },
      actor,
    );
    t.ctx.services.ai!.addText(null, { name: 'Delivery', text: 'Delivery RM10' }, actor);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/ai/try',
      headers: authHeaders(cookie),
      payload: { question: 'Delivery?', knowledge: { displayName: 'Agent', instructions: '' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, reply: 'RM10', model: 'claude-haiku-5-5' });
    expect(res.body).not.toContain('SECRET');
    expect(vi.mocked(provider.generate).mock.calls.at(-1)![1]).toBe(CLAUDE_KEY);
  });

  it('logs the connection change without any key', async () => {
    await save({ mode: 'claude', model: '', apiKey: CLAUDE_KEY });
    const audit = t.ctx.db
      .prepare(`SELECT meta FROM audit_log WHERE action = 'ai.connection_update'`)
      .all() as Array<{ meta: string }>;
    expect(audit.at(-1)!.meta).toContain('claude');
    expect(JSON.stringify(audit)).not.toContain('SECRET');
  });
});

describe('provider routing in Claude mode', { timeout: 30_000 }, () => {
  let t: TestApp;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await t.close();
  });

  it('sends generate, rewrite and extraction to Anthropic with the Claude key', async () => {
    t = await makeTestApp();
    const provider = new DirectChatGptProvider(t.ctx);
    const answer = (text: string) =>
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: CLAUDE_DEFAULT_MODEL,
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        answer(JSON.stringify({ reply: 'Hi', action: 'answer', handoffReason: null })),
      )
      .mockResolvedValueOnce(answer(JSON.stringify({ text: 'Formal' })))
      .mockResolvedValueOnce(answer(JSON.stringify({ fields: [] })));
    vi.stubGlobal('fetch', fetcher);
    const settings = {
      enabled: true,
      displayName: 'AI',
      mode: 'claude' as const,
      model: '',
      instructions: '',
    };
    const prompt = { instructions: 'Rules', input: '{}' };
    const signal = new AbortController().signal;
    expect(await provider.generate(settings, CLAUDE_KEY, prompt, signal)).toMatchObject({
      reply: 'Hi',
    });
    expect(await provider.rewrite(settings, CLAUDE_KEY, prompt, signal)).toEqual({
      text: 'Formal',
      model: CLAUDE_DEFAULT_MODEL,
    });
    expect(await provider.extractCustomer(settings, CLAUDE_KEY, prompt, signal)).toEqual({
      fields: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetcher.mock.calls as Array<[string, RequestInit]>) {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(new Headers(init.headers).get('x-api-key')).toBe(CLAUDE_KEY);
    }
    await provider.shutdown();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { CODEX_BACKEND } from '../src/ai/chatgpt-backend.js';
import { DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import { rewriteOpenAi } from '../src/ai/provider.js';
import type { AiProvider } from '../src/ai/provider-types.js';
import { answerText, CHATGPT_SETTINGS, seedTokens } from './chatgpt-fixtures.js';
import { createAiService } from '../src/ai/service.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

let t: TestApp;
let provider: AiProvider;
let connected: boolean;
let adminCookie: string;
let agentCookie: string;
let logLines: string[];

const CURRENT = 'ROLE\nYou are a cheerful sales assistant for Kedai Secret.';
const REQUEST = 'Make the tone more formal please';
const SUGGESTION = 'ROLE\nYou are a courteous sales assistant for Kedai Secret.';

beforeEach(async () => {
  logLines = [];
  connected = true;
  provider = {
    generate: vi.fn(),
    rewrite: vi.fn().mockResolvedValue({ text: `  ${SUGGESTION}\n`, model: 'gpt-test' }),
    connection: () =>
      connected
        ? { state: 'connected', loginUrl: null, error: null }
        : { state: 'signed_out', loginUrl: null, error: null },
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      const capture = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
      const child = ctx.log.child.bind(ctx.log);
      vi.spyOn(ctx.log, 'child').mockImplementation(((bindings: Record<string, unknown>) =>
        bindings.mod === 'ai' ? capture.child(bindings) : child(bindings)) as never);
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
  const agent = auth.createUser({
    username: 'agent',
    displayName: 'Agent',
    role: 'agent',
    password: 'password123',
    mustChangePassword: false,
  });
  adminCookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  agentCookie = `sid=${auth.createSession(agent.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  const actor = { userId: admin.id, ip: null };
  t.ctx.services.ai!.saveConnection({ mode: 'chatgpt', model: '' }, actor);
  t.ctx.services.ai!.saveMember({ displayName: 'Agent', enabled: false, instructions: '' }, actor);
  t.ctx.services.ai!.addText({ name: 'Hours', text: 'We open 9am to 6pm.' }, actor);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

const edit = (payload: object, cookie = adminCookie) =>
  t.app.inject({ method: 'POST', url: '/api/ai/edit', headers: authHeaders(cookie), payload });
const body = { field: 'instructions', current: CURRENT, request: REQUEST };

it('is admin-only', async () => {
  expect((await edit(body, agentCookie)).statusCode).toBe(403);
  expect(provider.rewrite).not.toHaveBeenCalled();
});

it('validates the body', async () => {
  expect((await edit({ ...body, request: '   ' })).statusCode).toBe(400);
  expect((await edit({ ...body, request: 'x'.repeat(501) })).statusCode).toBe(400);
  expect((await edit({ ...body, field: 'name' })).statusCode).toBe(400);
  expect(
    (await edit({ field: 'handoffRules', current: 'x'.repeat(4001), request: 'shorter' }))
      .statusCode,
  ).toBe(400);
  expect(provider.rewrite).not.toHaveBeenCalled();
});

it('asks to connect the AI first when the connection is not ready', async () => {
  connected = false;
  const res = await edit(body);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    ok: false,
    text: null,
    error: 'Connect the AI in Settings → AI first.',
  });
  expect(provider.rewrite).not.toHaveBeenCalled();
});

it('returns the trimmed suggestion from the editor prompt', async () => {
  const res = await edit(body);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, text: SUGGESTION, error: null });
  expect(provider.rewrite).toHaveBeenCalledTimes(1);
  const [settings, , prompt, signal] = vi.mocked(provider.rewrite!).mock.calls[0]!;
  expect(settings.mode).toBe('chatgpt');
  expect(signal).toBeInstanceOf(AbortSignal);
  const input = JSON.parse(prompt.input);
  expect(input).toMatchObject({ field: 'instructions', currentText: CURRENT, request: REQUEST });
  expect(input.businessKnowledge).toContain('We open 9am to 6pm.');
  expect(prompt.instructions).not.toContain(REQUEST);
  expect(prompt.cacheId).toBe(t.ctx.settings.get('ai_install_id', null));
  // Nothing is saved: the member's instructions are untouched.
  expect(t.ctx.services.ai!.status().settings.instructions).not.toBe(SUGGESTION);
});

it('rejects suggestions that are too long for the box', async () => {
  vi.mocked(provider.rewrite!).mockResolvedValueOnce({ text: 'x'.repeat(4001), model: 'm' });
  const res = await edit({ field: 'handoffRules', current: '- Refunds.', request: 'add more' });
  expect(res.json()).toEqual({
    ok: false,
    text: null,
    error: 'The suggestion is too long for this box. Try a smaller change.',
  });
});

it('rejects empty suggestions', async () => {
  vi.mocked(provider.rewrite!).mockResolvedValueOnce({ text: '  \n ', model: 'm' });
  expect((await edit(body)).json()).toEqual({
    ok: false,
    text: null,
    error: 'The AI returned an empty suggestion. Try again.',
  });
});

it('passes provider errors on', async () => {
  vi.mocked(provider.rewrite!).mockRejectedValueOnce(new Error('ChatGPT could not answer.'));
  expect((await edit(body)).json()).toEqual({
    ok: false,
    text: null,
    error: 'ChatGPT could not answer.',
  });
});

it('stops the AI call when the edit is cancelled (the admin closed the popup)', async () => {
  let seen: AbortSignal | undefined;
  vi.mocked(provider.rewrite!).mockImplementationOnce(
    (_settings, _key, _prompt, signal) =>
      new Promise((_resolve, reject) => {
        seen = signal;
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
      }),
  );
  const controller = new AbortController();
  const pending = t.ctx.services.ai!.editText(
    { field: 'instructions', current: CURRENT, request: REQUEST },
    controller.signal,
  );
  await vi.waitFor(() => expect(seen).toBeDefined());
  controller.abort();
  expect(await pending).toMatchObject({ ok: false, text: null });
  expect(seen!.aborted).toBe(true);
});

it('logs one line without the request, current text or suggestion', async () => {
  await edit(body);
  const lines = logLines.filter((line) => line.includes('"ai_edit"'));
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: 'ai_edit',
    field: 'instructions',
    ok: true,
    model: 'gpt-test',
    msg: 'AI edit',
  });
  const all = logLines.join('\n');
  expect(all).not.toContain('formal please');
  expect(all).not.toContain('Kedai Secret');
  expect(all).not.toContain('courteous');
});

it('allows 10 edits per minute per admin, then 429', async () => {
  for (let i = 0; i < 10; i++) expect((await edit(body)).statusCode).toBe(200);
  const limited = await edit(body);
  expect(limited.statusCode).toBe(429);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(provider.rewrite).toHaveBeenCalledTimes(10);
});

describe('provider rewrite (network mocked)', () => {
  const prompt = { instructions: 'Edit the setting.', input: '{"field":"handoffRules"}' };

  it('ChatGPT mode: one tool-free Codex request with the resolved model', async () => {
    seedTokens(t.ctx);
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      answerText(JSON.stringify({ text: '- Refunds.' })),
    );
    const real = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const result = await real.rewrite(
      { ...CHATGPT_SETTINGS, model: 'gpt-6-astra' },
      null,
      prompt,
      new AbortController().signal,
    );
    expect(result).toEqual({ text: '- Refunds.', model: 'gpt-6-astra' });
    const calls = fetchMock.mock.calls.filter((c) => c[0] === CODEX_BACKEND.responsesUrl);
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(String(calls[0]![1]!.body));
    expect(sent.instructions).toBe('Edit the setting.');
    expect(sent.tools ?? []).toEqual([]);
    await real.shutdown();
  });

  it('ChatGPT mode: output outside the format is a fixed error', async () => {
    seedTokens(t.ctx);
    const fetchMock = vi.fn(async () => answerText('not json'));
    const real = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    await expect(
      real.rewrite(
        { ...CHATGPT_SETTINGS, model: 'gpt-6-astra' },
        null,
        prompt,
        new AbortController().signal,
      ),
    ).rejects.toThrow('ChatGPT returned an invalid answer.');
    await real.shutdown();
  });

  it('API key mode: needs a key, then calls OpenAI once with the default model', async () => {
    const settings = { ...CHATGPT_SETTINGS, mode: 'api' as const, model: '' };
    await expect(
      rewriteOpenAi(settings, null, prompt, new AbortController().signal),
    ).rejects.toThrow('Add an OpenAI API key');
    const fetcher = vi.fn().mockResolvedValue(
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
              content: [{ type: 'output_text', text: '{"text":"- Refunds."}', annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(
        await rewriteOpenAi(settings, 'sk-test', prompt, new AbortController().signal),
      ).toEqual({ text: '- Refunds.', model: 'gpt-4.1-mini' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

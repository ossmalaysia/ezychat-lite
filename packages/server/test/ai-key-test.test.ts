import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { AI_PROVIDER_KEY, AI_SECRET_KEY, aiProviderSettings } from '../src/ai/settings-keys.js';
import { createAiKeyTester, OPENAI_MODELS_URL } from '../src/ai/key-test.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const KEY = 'sk-test-SECRET-key-0123456789';

function capture() {
  const lines: string[] = [];
  const log = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) });
  return { lines, log };
}

const reply = (status: number) => vi.fn(async () => new Response('{}', { status }));

describe('createAiKeyTester', () => {
  it('lists models with the key as a bearer token', async () => {
    const { log } = capture();
    const fetchMock = reply(200);
    const result = await createAiKeyTester({ log, fetch: fetchMock as never })(KEY);
    expect(result).toEqual({ ok: true, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_MODELS_URL);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, 'invalid_key'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'unreachable'],
    [503, 'unreachable'],
  ] as const)('maps HTTP %i to %s', async (status, error) => {
    const { log } = capture();
    const result = await createAiKeyTester({ log, fetch: reply(status) as never })(KEY);
    expect(result).toEqual({ ok: false, error });
  });

  it('reports a network failure as unreachable', async () => {
    const { log } = capture();
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${KEY}`);
    });
    const result = await createAiKeyTester({ log, fetch: fetchMock as never })(KEY);
    expect(result).toEqual({ ok: false, error: 'unreachable' });
  });

  it('gives up after the timeout', async () => {
    const { log } = capture();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const started = Date.now();
    const result = await createAiKeyTester({ log, fetch: fetchMock as never, timeoutMs: 30 })(KEY);
    expect(result).toEqual({ ok: false, error: 'unreachable' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('logs the result and duration, never the key', async () => {
    const { lines, log } = capture();
    await createAiKeyTester({ log, fetch: reply(401) as never })(KEY);
    await createAiKeyTester({
      log,
      fetch: vi.fn(async () => {
        throw new Error(KEY);
      }) as never,
    })(KEY);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first).toMatchObject({
      mod: 'ai',
      event: 'ai_key_test',
      ok: false,
      error: 'invalid_key',
    });
    expect(typeof first.ms).toBe('number');
    expect(lines.join('\n')).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain('SECRET');
  });
});

describe('POST /api/ai/connection/test', () => {
  let t: TestApp;
  let adminCookie: string;
  let agentCookie: string;
  let status: number;
  let fetchMock: ReturnType<typeof vi.fn>;
  let logLines: string[];

  beforeEach(async () => {
    status = 200;
    fetchMock = vi.fn(async () => new Response('{}', { status }));
    logLines = [];
    t = await makeTestApp({
      beforeBuild: (ctx) => {
        const log = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
        ctx.services.aiKeyTest = createAiKeyTester({ log, fetch: fetchMock as never });
      },
    });
    const auth = t.ctx.services.auth!;
    const create = (username: string, role: 'admin' | 'agent') =>
      auth.createUser({
        username,
        displayName: username,
        role,
        password: 'password123',
        mustChangePassword: false,
      });
    const admin = create('admin', 'admin');
    const agent = create('agent', 'agent');
    adminCookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
    agentCookie = `sid=${auth.createSession(agent.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  });
  afterEach(async () => {
    await t.close();
  });

  const post = (cookie: string | null, body: unknown = { apiKey: KEY }) =>
    t.app.inject({
      method: 'POST',
      url: '/api/ai/connection/test',
      headers: cookie ? authHeaders(cookie) : { host: 'localhost', origin: 'http://localhost' },
      payload: body as object,
    });

  it('answers ok for a working key without saving it', async () => {
    const res = await post(adminCookie, { apiKey: `  ${KEY}  ` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, error: null });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(t.ctx.settings.getSecret(AI_SECRET_KEY)).toBeNull();
    expect(t.ctx.settings.get(AI_PROVIDER_KEY, null)).toBeNull();
    expect(logLines.join('\n')).not.toContain(KEY);
  });

  it.each([
    [401, 'invalid_key'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [502, 'unreachable'],
  ] as const)('returns %s results as data', async (code, error) => {
    status = code;
    const res = await post(adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error });
  });

  it('rejects a blank key without calling OpenAI', async () => {
    const res = await post(adminCookie, { apiKey: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(KEY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is admin only', async () => {
    expect((await post(null)).statusCode).toBe(401);
    expect((await post(agentCookie)).statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is rate limited per admin', async () => {
    for (let i = 0; i < 10; i++) expect((await post(adminCookie)).statusCode).toBe(200);
    const limited = await post(adminCookie);
    expect(limited.statusCode).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});

describe('default AI connection mode', () => {
  let t: TestApp | null = null;
  afterEach(async () => {
    vi.restoreAllMocks();
    await t?.close();
    t = null;
  });

  async function adminApp() {
    t = await makeTestApp();
    const auth = t.ctx.services.auth!;
    const admin = auth.createUser({
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      password: 'password123',
      mustChangePassword: false,
    });
    return `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  }

  it('is ChatGPT on a fresh data dir, signed out, with the AI member off and no outside call', async () => {
    const outside = vi.spyOn(globalThis, 'fetch');
    const cookie = await adminApp();
    const res = await t!.app.inject({
      method: 'GET',
      url: '/api/ai',
      headers: authHeaders(cookie),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.mode).toBe('chatgpt');
    expect(body.settings.enabled).toBe(false);
    expect(body.member).toBeNull();
    expect(body.connection.state).toBe('signed_out');
    expect(t!.ctx.services.ai!.connectionReady()).toBe(false);
    // Reading the default never saves it, so a later API-key save is a plain choice.
    expect(t!.ctx.settings.get(AI_PROVIDER_KEY, null)).toBeNull();
    expect(outside).not.toHaveBeenCalled();
  });

  it('keeps a saved API-key connection', async () => {
    const cookie = await adminApp();
    const saved = await t!.app.inject({
      method: 'PATCH',
      url: '/api/ai/connection',
      headers: authHeaders(cookie),
      payload: { mode: 'api', model: '', apiKey: 'sk-saved-key-123456' },
    });
    expect(saved.statusCode).toBe(200);
    const res = await t!.app.inject({
      method: 'GET',
      url: '/api/ai',
      headers: authHeaders(cookie),
    });
    expect(res.json().settings.mode).toBe('api');
    expect(res.json().connection.state).toBe('connected');
  });

  it('keeps API-key mode for older saves and stored keys', async () => {
    t = await makeTestApp();
    const settings = t.ctx.settings;
    expect(aiProviderSettings(settings)).toEqual({ mode: 'chatgpt', model: '' });
    settings.setSecret(AI_SECRET_KEY, 'sk-legacy-key-123456');
    expect(aiProviderSettings(settings)).toEqual({ mode: 'api', model: '' });
    settings.setSecret(AI_SECRET_KEY, null);
    settings.set(AI_PROVIDER_KEY, { model: 'gpt-4.1' });
    expect(aiProviderSettings(settings)).toEqual({ mode: 'api', model: 'gpt-4.1' });
    settings.set(AI_PROVIDER_KEY, { mode: 'chatgpt', model: '' });
    expect(aiProviderSettings(settings)).toEqual({ mode: 'chatgpt', model: '' });
  });
});

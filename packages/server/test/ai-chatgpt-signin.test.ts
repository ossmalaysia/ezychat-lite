import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConnection } from '@wa-team-inbox/shared';
import { CHATGPT_OAUTH, parseCallbackUrl } from '../src/ai/chatgpt-oauth.js';
import { CHATGPT_TOKENS_SECRET, DirectChatGptProvider } from '../src/ai/chatgpt-direct.js';
import { createAiService } from '../src/ai/service.js';
import type { AiProvider } from '../src/ai/provider-types.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';
import { freePort, json, seedTokens, tokenResponse } from './chatgpt-fixtures.js';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const callback = (query: string) => `http://localhost:1455/auth/callback?${query}`;
const stateOf = (connection: AiConnection) =>
  new URL(connection.loginUrl!).searchParams.get('state')!;

function users(app: TestApp) {
  const auth = app.ctx.services.auth!;
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
  return {
    admin,
    adminCookie: `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`,
    agentCookie: `sid=${auth.createSession(agent.id, { ip: '127.0.0.1', userAgent: 't' })}`,
  };
}

describe('parseCallbackUrl', () => {
  it('accepts only the sign-in redirect address', () => {
    expect(parseCallbackUrl(`  ${callback('code=c&state=s')}  `)).toEqual({
      state: 's',
      code: 'c',
      error: null,
    });
    expect(
      parseCallbackUrl('http://127.0.0.1:1455/auth/callback?state=s&error=access_denied'),
    ).toEqual({ state: 's', code: null, error: 'access_denied' });
    for (const bad of [
      'not a url',
      'https://localhost:1455/auth/callback?code=c&state=s',
      'http://evil.example:1455/auth/callback?code=c&state=s',
      'http://localhost:1456/auth/callback?code=c&state=s',
      'http://localhost:1455/other?code=c&state=s',
      'http://user:pw@localhost:1455/auth/callback?code=c&state=s',
      'http://localhost:1455/auth/callback?code=c',
    ])
      expect(parseCallbackUrl(bad)).toBeNull();
  });
});

describe('DirectChatGptProvider sign-in', () => {
  it('lets only one sign-in run: a new one cancels the old and only the newest state completes', async () => {
    t = await makeTestApp();
    const port = await freePort();
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse());
    const provider = new DirectChatGptProvider(t.ctx, {
      fetch: fetchMock as typeof fetch,
      callbackPort: port,
    });
    const [a, b] = await Promise.all([provider.login(), provider.login()]);
    expect(a.loginUrl).toBe(b.loginUrl);
    const second = await provider.login();
    expect(stateOf(second)).not.toBe(stateOf(a));
    const stale = await fetch(
      `http://127.0.0.1:${port}/auth/callback?code=old&state=${stateOf(a)}`,
    );
    expect(stale.status).toBe(400);
    expect(provider.connection().state).toBe('signing_in');
    await fetch(`http://127.0.0.1:${port}/auth/callback?code=new&state=${stateOf(second)}`);
    await vi.waitFor(() => expect(provider.connection().state).toBe('connected'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(fetchMock.mock.calls[0]![1]!.body as URLSearchParams)).toMatchObject({
      code: 'new',
    });
    await provider.shutdown();
  });

  it('finishes a sign-in from a pasted callback address (remote admin over tunnel or LAN)', async () => {
    t = await makeTestApp();
    const port = await freePort();
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse());
    const provider = new DirectChatGptProvider(t.ctx, {
      fetch: fetchMock as typeof fetch,
      callbackPort: port,
    });
    await expect(provider.submitCallbackUrl(callback('code=x&state=y'))).rejects.toThrow(
      'No ChatGPT sign-in is in progress',
    );
    const state = stateOf(await provider.login());
    await expect(provider.submitCallbackUrl('https://evil.example/steal')).rejects.toThrow(
      'Paste the full address',
    );
    await expect(provider.submitCallbackUrl(callback('code=x&state=wrong'))).rejects.toThrow(
      'another sign-in attempt',
    );
    expect(provider.connection().state).toBe('signing_in');
    const done = await provider.submitCallbackUrl(`  ${callback(`code=pasted&state=${state}`)}  `);
    expect(done).toMatchObject({ state: 'connected', email: 'owner@example.com' });
    expect(Object.fromEntries(fetchMock.mock.calls[0]![1]!.body as URLSearchParams)).toMatchObject({
      code: 'pasted',
      redirect_uri: CHATGPT_OAUTH.redirectUri,
    });
    expect(t.ctx.settings.getSecret(CHATGPT_TOKENS_SECRET)).not.toBeNull();
    await provider.shutdown();
  });

  it('exchanges a code once when the browser and a pasted address race', async () => {
    t = await makeTestApp();
    const port = await freePort();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
      await gate;
      return tokenResponse();
    });
    const provider = new DirectChatGptProvider(t.ctx, {
      fetch: fetchMock as typeof fetch,
      callbackPort: port,
    });
    const state = stateOf(await provider.login());
    const pasted = provider.submitCallbackUrl(callback(`code=pasted&state=${state}`));
    await expect(provider.submitCallbackUrl(callback(`code=again&state=${state}`))).rejects.toThrow(
      'already finishing',
    );
    const browser = fetch(`http://127.0.0.1:${port}/auth/callback?code=browser&state=${state}`);
    release();
    await pasted;
    await browser.catch(() => null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.connection().state).toBe('connected');
    await provider.shutdown();
  });

  it('reports a rejected pasted code as a sign-in error', async () => {
    t = await makeTestApp();
    const port = await freePort();
    const fetchMock = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    const provider = new DirectChatGptProvider(t.ctx, {
      fetch: fetchMock as unknown as typeof fetch,
      callbackPort: port,
    });
    const state = stateOf(await provider.login());
    const result = await provider.submitCallbackUrl(callback(`code=bad&state=${state}`));
    expect(result).toMatchObject({
      state: 'error',
      error: 'ChatGPT sign-in was rejected. Sign in again.',
    });
    await provider.shutdown();
  });
});

describe('ChatGPT sign-in routes', () => {
  it('rate-limits starting a sign-in and pasting addresses per admin; agents are refused', async () => {
    let connection: AiConnection = { state: 'signed_out', loginUrl: null, error: null };
    const provider: AiProvider = {
      generate: vi.fn(),
      connection: () => connection,
      login: vi.fn(async () => {
        connection = {
          state: 'signing_in',
          loginUrl: 'https://auth.openai.com/oauth/authorize?x=1',
          error: null,
        };
        return connection;
      }),
      logout: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      submitCallbackUrl: vi.fn(async () => {
        connection = { state: 'connected', loginUrl: null, error: null, email: 'o@example.com' };
        return connection;
      }),
    };
    t = await makeTestApp({
      beforeBuild: async (ctx) => {
        await ctx.services.ai!.shutdown();
        ctx.services.ai = createAiService(ctx, { provider });
      },
    });
    const app = t;
    const { admin, adminCookie, agentCookie } = users(app);
    app.ctx.services.ai!.saveConnection(
      { mode: 'chatgpt', model: '' },
      { userId: admin.id, ip: null },
    );
    const login = (cookie: string) =>
      app.app.inject({
        method: 'POST',
        url: '/api/ai/chatgpt/login',
        headers: authHeaders(cookie),
      });
    const paste = (cookie: string, url: string) =>
      app.app.inject({
        method: 'POST',
        url: '/api/ai/chatgpt/callback',
        headers: authHeaders(cookie),
        payload: { url },
      });

    expect((await login(agentCookie)).statusCode).toBe(403);
    expect((await paste(agentCookie, callback('code=c&state=s'))).statusCode).toBe(403);
    for (let i = 0; i < 5; i++) expect((await login(adminCookie)).statusCode).toBe(200);
    const limited = await login(adminCookie);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    expect((await paste(adminCookie, '')).statusCode).toBe(400);
    const pasted = await paste(adminCookie, callback('code=c&state=s'));
    expect(pasted.statusCode).toBe(200);
    expect(pasted.json().connection).toMatchObject({ state: 'connected' });
    expect(provider.submitCallbackUrl).toHaveBeenCalledWith(callback('code=c&state=s'));
    for (let i = 0; i < 8; i++) await paste(adminCookie, callback('code=c&state=s'));
    expect((await paste(adminCookie, callback('code=c&state=s'))).statusCode).toBe(429);
  });

  it('keeps ChatGPT tokens when switching to API mode and deletes them on sign-out', async () => {
    t = await makeTestApp();
    const app = t;
    const { adminCookie } = users(app);
    seedTokens(app.ctx);
    const toApi = await app.app.inject({
      method: 'PATCH',
      url: '/api/ai/connection',
      headers: authHeaders(adminCookie),
      payload: { mode: 'api', model: '' },
    });
    expect(toApi.statusCode).toBe(200);
    expect(app.ctx.settings.getSecret(CHATGPT_TOKENS_SECRET)).not.toBeNull();
    const out = await app.app.inject({
      method: 'POST',
      url: '/api/ai/chatgpt/logout',
      headers: authHeaders(adminCookie),
    });
    expect(out.statusCode).toBe(200);
    expect(app.ctx.settings.getSecret(CHATGPT_TOKENS_SECRET)).toBeNull();
  });
});

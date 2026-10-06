import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHATGPT_OAUTH } from '../src/ai/chatgpt-oauth.js';
import { CODEX_BACKEND } from '../src/ai/chatgpt-backend.js';
import { CHATGPT_BLOCKED, DirectChatGptProvider, SIGN_IN_AGAIN } from '../src/ai/chatgpt-direct.js';
import { makeTestApp, type TestApp } from './helpers.js';
import {
  ACCESS,
  ACCESS_2,
  CHATGPT_SETTINGS,
  answer,
  answerText,
  json,
  seedTokens,
  tokenResponse,
} from './chatgpt-fixtures.js';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});
const prompt = { instructions: 'rules', input: 'hi' };
const ask = (provider: DirectChatGptProvider) =>
  provider.generate(CHATGPT_SETTINGS, null, prompt, new AbortController().signal);
const authOf = (init?: RequestInit) => (init?.headers as Record<string, string>).authorization;

describe('ChatGPT token refresh', () => {
  it('refreshes ahead of expiry, before calling ChatGPT', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx, { expiresAt: Date.now() + 60_000 });
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url) === CHATGPT_OAUTH.tokenUrl
        ? tokenResponse({ access_token: ACCESS_2, refresh_token: 'refresh-2' })
        : answer('Hello'),
    );
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    expect(await ask(provider)).toEqual({ reply: 'Hello', action: 'answer' });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(CHATGPT_OAUTH.tokenUrl);
    expect(authOf(fetchMock.mock.calls[1]![1])).toBe(`Bearer ${ACCESS_2}`);
  });

  it('shares one refresh between concurrent 401s, even when a 401 arrives after the rotation', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx);
    const spent = new Set<string>();
    let tokenCalls = 0;
    let oldTokenAnswers = 0;
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === CHATGPT_OAUTH.tokenUrl) {
        tokenCalls++;
        const refresh = (init!.body as URLSearchParams).get('refresh_token')!;
        // OpenAI rotates refresh tokens: a spent one is rejected.
        if (spent.has(refresh)) return json({ error: 'invalid_grant' }, 400);
        spent.add(refresh);
        return tokenResponse({ access_token: ACCESS_2, refresh_token: 'refresh-2' });
      }
      if (authOf(init) === `Bearer ${ACCESS}`) {
        oldTokenAnswers++;
        if (oldTokenAnswers === 2) await secondGate;
        return json({ error: { code: 'token_expired' } }, 401);
      }
      return answer('Hello');
    });
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const first = ask(provider);
    const second = ask(provider);
    await expect(first).resolves.toEqual({ reply: 'Hello', action: 'answer' });
    releaseSecond();
    await expect(second).resolves.toEqual({ reply: 'Hello', action: 'answer' });
    expect(tokenCalls).toBe(1);
    expect(provider.connection().state).toBe('connected');
  });

  it('moves to "expired" when the refresh token is rejected', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx, { expiresAt: Date.now() + 60_000 });
    const fetchMock = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    const provider = new DirectChatGptProvider(t.ctx, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(ask(provider)).rejects.toThrow('Sign in again');
    expect(provider.connection()).toMatchObject({
      state: 'expired',
      error: SIGN_IN_AGAIN,
      email: 'owner@example.com',
    });
  });

  it('moves to "expired" when a freshly refreshed token is still refused', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx);
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url) === CHATGPT_OAUTH.tokenUrl
        ? tokenResponse({ access_token: ACCESS_2, refresh_token: 'refresh-2' })
        : json({ error: { code: 'token_expired' } }, 401),
    );
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    await expect(ask(provider)).rejects.toThrow();
    expect(provider.connection().state).toBe('expired');
  });
});

describe('blocked or changed ChatGPT endpoint', () => {
  it.each([
    ['403', () => json({ error: { code: 'forbidden' } }, 403)],
    ['404', () => json({}, 404)],
    [
      'an HTML page',
      () =>
        new Response('<html>Just a moment…</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ],
  ])(
    'marks the connection blocked on %s and recovers after a successful test',
    async (_name, blocked) => {
      t = await makeTestApp();
      seedTokens(t.ctx);
      let healthy = false;
      const fetchMock = vi.fn(async (url: unknown) =>
        String(url) === CODEX_BACKEND.responsesUrl
          ? healthy
            ? answerText('OK')
            : blocked()
          : json({}, 404),
      );
      const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
      await expect(ask(provider)).rejects.toThrow(CHATGPT_BLOCKED);
      expect(provider.connection()).toMatchObject({ state: 'error', error: CHATGPT_BLOCKED });
      healthy = true;
      expect(await provider.test('gpt-5.5')).toMatchObject({ ok: true, reply: 'OK' });
      expect(provider.connection().state).toBe('connected');
    },
  );

  it('keeps a working connection when only a new sign-in attempt fails', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx);
    const provider = new DirectChatGptProvider(t.ctx, { callbackPort: 0, loginTimeoutMs: 20 });
    await provider.login();
    await vi.waitFor(() => expect(provider.connection().error).toContain('timed out'));
    expect(provider.connection().state).toBe('connected');
    await provider.shutdown();
  });

  it('treats one empty event stream as a transient failure, not a block', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx);
    const fetchMock = vi.fn(
      async () =>
        new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    await expect(ask(provider)).rejects.toThrow();
    expect(provider.connection().state).toBe('connected');
  });

  it('notifies listeners once when the connection newly breaks', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx);
    const fetchMock = vi.fn(async () => json({}, 403));
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const listener = vi.fn();
    provider.onProblem(listener);
    await expect(ask(provider)).rejects.toThrow();
    await expect(ask(provider)).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('requests that outlive a sign-out', () => {
  it('does not mark a new sign-in blocked when an old request is refused later', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchMock = vi.fn(async () => {
      await gate;
      return json({}, 403);
    });
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const old = ask(provider);
    const settled = old.catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await provider.logout();
    seedTokens(t.ctx);
    release();
    await settled;
    expect(provider.connection().state).toBe('connected');
  });

  it('does not mark a new sign-in expired when an old retried request is refused later', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let answers = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url) === CHATGPT_OAUTH.tokenUrl)
        return tokenResponse({ access_token: ACCESS_2, refresh_token: 'refresh-2' });
      if (++answers === 2) await gate;
      return json({ error: { code: 'token_expired' } }, 401);
    });
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const settled = ask(provider).catch(() => {});
    await vi.waitFor(() => expect(answers).toBe(2));
    await provider.logout();
    seedTokens(t.ctx);
    release();
    await settled;
    expect(provider.connection().state).toBe('connected');
  });

  it('does not reuse a refresh that was started for a previous sign-in', async () => {
    t = await makeTestApp();
    seedTokens(t.ctx, { expiresAt: Date.now() + 60_000 });
    let tokenCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url) === CHATGPT_OAUTH.tokenUrl) {
        if (++tokenCalls === 1) await gate;
        return tokenResponse({ access_token: ACCESS_2, refresh_token: 'refresh-2' });
      }
      return answer('Hello');
    });
    const provider = new DirectChatGptProvider(t.ctx, { fetch: fetchMock as typeof fetch });
    const stale = ask(provider).catch(() => {});
    await vi.waitFor(() => expect(tokenCalls).toBe(1));
    await provider.logout();
    seedTokens(t.ctx, { expiresAt: Date.now() + 60_000 });
    expect(await ask(provider)).toEqual({ reply: 'Hello', action: 'answer' });
    expect(tokenCalls).toBe(2);
    release();
    await stale;
  });
});

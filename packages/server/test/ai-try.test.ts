import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

let t: TestApp;
let provider: AiProvider;
let cookie: string;
const knowledge = { displayName: 'Agent', instructions: '', context: 'Delivery RM10' };

beforeEach(async () => {
  provider = {
    generate: vi.fn().mockResolvedValue({ reply: 'RM10', action: 'answer' }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
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
  cookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  t.ctx.services.ai!.saveConnection(
    { mode: 'api', model: '', apiKey: 'test-api-key-123' },
    { userId: admin.id, ip: null },
  );
});
afterEach(async () => {
  await t.close();
});
const ask = (question: string) =>
  t.app.inject({
    method: 'POST',
    url: '/api/ai/try',
    headers: authHeaders(cookie),
    payload: { question, knowledge },
  });

it('caps the question at 500 characters', async () => {
  expect((await ask('x'.repeat(500))).statusCode).toBe(200);
  expect((await ask('x'.repeat(501))).statusCode).toBe(400);
  expect((await ask('   ')).statusCode).toBe(400);
});

it('allows 10 answers per minute per admin, then 429 with retry-after', async () => {
  for (let i = 0; i < 10; i++) {
    const res = await ask('Delivery?');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, reply: 'RM10', model: 'gpt-4.1-mini' });
  }
  const limited = await ask('Delivery?');
  expect(limited.statusCode).toBe(429);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(provider.generate).toHaveBeenCalledTimes(10);
});

it('never creates chats or sends WhatsApp', async () => {
  await ask('Delivery?');
  expect(t.wa.sent).toHaveLength(0);
  expect(t.ctx.db.prepare('SELECT count(*) AS n FROM chats').get()).toEqual({ n: 0 });
});

// Public extension routes (implementation.md, Lite server 10): a webhook at /api/ext/<name>/public
// needs no session and no Origin, keeps its raw body and must pass the extension's `verify`; every
// other route keeps the Origin check, and the Host allowlist and the access gate still apply.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireUser, type ServerExtension } from '../src/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const SECRET = 'app-secret';
const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('hex');

let t: TestApp;
let handled: Array<{ raw: string | null; body: unknown }>;

function hooky(): ServerExtension {
  return {
    name: 'hooky',
    publicRoutes: {
      verify(req) {
        if (req.headers['x-verify-throws']) throw new Error('verify crashed');
        if (req.method === 'GET')
          return req.query !== null && (req.query as { token?: string }).token === 'ok';
        const raw = req.rawBody?.toString('utf8') ?? '';
        return req.headers['x-signature'] === sign(raw);
      },
      async routes(api) {
        api.get('/hook', async (req) => ({ challenge: (req.query as { c?: string }).c ?? null }));
        api.post('/hook', async (req) => {
          const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
          handled.push({ raw: raw ? raw.toString('utf8') : null, body: req.body });
          return { ok: true };
        });
      },
    },
    routes: async (api, ctx) => {
      api.post('/x', { preHandler: requireUser(ctx) }, async () => ({ ok: true }));
    },
  };
}

/** An extension with an ordinary route that happens to be named /public/…: no exception for it. */
const plain: ServerExtension = {
  name: 'plain',
  routes: async (api) => {
    api.post('/public/hook', async () => ({ ok: true }));
  },
};

beforeEach(async () => {
  handled = [];
  t = await makeTestApp({ edition: 'enterprise', extensions: [hooky(), plain] });
});
afterEach(async () => {
  await t.close();
});

const webhook = (
  raw: string,
  headers: Record<string, string> = {},
  url = '/api/ext/hooky/public/hook',
) =>
  t.app.inject({
    method: 'POST',
    url,
    headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
    payload: raw,
  });

describe('public extension routes', () => {
  it('accepts a signed POST with no Origin and no session, with the raw body kept', async () => {
    const raw = '{"entry":[{"id":"1"}]}';
    const res = await webhook(raw, { 'x-signature': sign(raw) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(handled).toEqual([{ raw, body: { entry: [{ id: '1' }] } }]);
  });

  it('skips the Origin check only there: a foreign Origin or a cookie without Origin still passes', async () => {
    const raw = '{"a":1}';
    const foreign = await webhook(raw, {
      'x-signature': sign(raw),
      origin: 'https://evil.example',
    });
    expect(foreign.statusCode).toBe(200);
    const cookieOnly = await webhook(raw, { 'x-signature': sign(raw), cookie: 'sid=whatever' });
    expect(cookieOnly.statusCode).toBe(200);
    expect(handled).toHaveLength(2);
  });

  it('answers 401 unauthorized when verify fails or throws, and never runs the handler', async () => {
    const raw = '{"a":1}';
    for (const headers of [
      {} as Record<string, string>,
      { 'x-signature': sign('{"a":2}') },
      { 'x-signature': sign(raw), 'x-verify-throws': '1' },
    ]) {
      const res = await webhook(raw, headers);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
    expect(handled).toEqual([]);
  });

  it('runs verify for GET too (a webhook verification) and keeps non-JSON bodies raw', async () => {
    const ok = await t.app.inject({
      method: 'GET',
      url: '/api/ext/hooky/public/hook?token=ok&c=42',
      headers: { host: 'localhost' },
    });
    expect(ok.json()).toEqual({ challenge: '42' });
    const bad = await t.app.inject({
      method: 'GET',
      url: '/api/ext/hooky/public/hook?token=no&c=42',
      headers: { host: 'localhost' },
    });
    expect(bad.statusCode).toBe(401);
    const text = 'plain=text';
    const res = await webhook(text, {
      'x-signature': sign(text),
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(res.statusCode).toBe(200);
    expect(handled[0]!.raw).toBe(text);
    const invalid = await webhook('{oops', { 'x-signature': sign('{oops') });
    expect(invalid.statusCode).toBe(400);
  });

  it("keeps Origin and session on the extension's other routes and on other extensions", async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const x = (headers: Record<string, string>) =>
      t.app.inject({ method: 'POST', url: '/api/ext/hooky/x', headers, payload: {} });
    expect((await x({ host: 'localhost' })).statusCode).toBe(401);
    expect(
      (await x({ ...authHeaders(admin.cookie), origin: 'https://evil.example' })).statusCode,
    ).toBe(403);
    expect((await x(authHeaders(admin.cookie))).statusCode).toBe(200);
    // an extension without publicRoutes gets no exception for a path named /public
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/ext/plain/public/hook',
      headers: { host: 'localhost', origin: 'https://evil.example' },
      payload: {},
    });
    expect(other.statusCode).toBe(403);
    // an encoded path is not the public prefix: the Origin check applies
    const encoded = await webhook(
      '{}',
      {
        origin: 'https://evil.example',
        'x-signature': sign('{}'),
      },
      '/api/ext/hooky/%70ublic/hook',
    );
    expect(encoded.statusCode).toBe(403);
    expect(handled).toEqual([]);
  });

  it('keeps the Host allowlist and the access gate', async () => {
    const raw = '{}';
    const foreignHost = await webhook(raw, { 'x-signature': sign(raw), host: 'evil.example' });
    expect(foreignHost.statusCode).toBe(403);
    t.ctx.access.close({ code: 'license_required' });
    const closed = await webhook(raw, { 'x-signature': sign(raw) });
    expect(closed.statusCode).toBe(403);
    expect(closed.json()).toEqual({ error: 'license_required' });
    expect(handled).toEqual([]);
  });
});

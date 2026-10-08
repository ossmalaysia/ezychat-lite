import { afterAll, beforeAll, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

/** Every /api/integrations route. A new route must be added here. */
const ROUTES = [
  { method: 'GET', url: '/api/integrations/mcp' },
  { method: 'PATCH', url: '/api/integrations/mcp' },
  { method: 'GET', url: '/api/integrations/tokens' },
  { method: 'POST', url: '/api/integrations/tokens' },
  { method: 'DELETE', url: '/api/integrations/tokens/1' },
] as const;

let t: TestApp;
let adminCookie: string;
let agentCookie: string;
beforeAll(async () => {
  t = await makeTestApp();
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
afterAll(async () => {
  await t.close();
});

it.each(ROUTES)('$method $url is admin-only', async ({ method, url }) => {
  const anonymous = await t.app.inject({
    method,
    url,
    headers: { host: 'localhost', origin: 'http://localhost' },
  });
  expect(anonymous.statusCode).toBe(401);
  const agent = await t.app.inject({ method, url, headers: authHeaders(agentCookie) });
  expect(agent.statusCode).toBe(403);
});

it.each(ROUTES.filter((r) => r.method !== 'GET'))(
  '$method $url rejects a foreign Origin even for an admin',
  async ({ method, url }) => {
    const res = await t.app.inject({
      method,
      url,
      headers: { cookie: adminCookie, host: 'localhost', origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
  },
);

it('creates a token once, lists it without the secret, and revokes it', async () => {
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/integrations/tokens',
    headers: authHeaders(adminCookie),
    payload: { name: 'Claude Code' },
  });
  expect(created.statusCode).toBe(201);
  expect(created.headers['cache-control']).toBe('no-store');
  const { token, secret } = created.json();
  expect(token.name).toBe('Claude Code');
  expect(token.userName).toBe('admin');
  expect(token.expiresAt - token.createdAt).toBe(90 * 24 * 60 * 60 * 1000);

  const list = await t.app.inject({
    method: 'GET',
    url: '/api/integrations/tokens',
    headers: authHeaders(adminCookie),
  });
  expect(list.json().tokens.map((x: { id: number }) => x.id)).toContain(token.id);
  expect(list.body).not.toContain(secret);

  // A token never authenticates /api, so it can never manage tokens.
  const viaToken = await t.app.inject({
    method: 'GET',
    url: '/api/integrations/tokens',
    headers: { host: 'localhost', authorization: `Bearer ${secret}` },
  });
  expect(viaToken.statusCode).toBe(401);

  const revoked = await t.app.inject({
    method: 'DELETE',
    url: `/api/integrations/tokens/${token.id}`,
    headers: authHeaders(adminCookie),
  });
  expect(revoked.statusCode).toBe(204);
  const again = await t.app.inject({
    method: 'DELETE',
    url: `/api/integrations/tokens/${token.id}`,
    headers: authHeaders(adminCookie),
  });
  expect(again.statusCode).toBe(404);
  const actions = (
    t.ctx.db
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'api_token.%'")
      .all() as Array<{
      action: string;
    }>
  ).map((r) => r.action);
  expect(actions).toEqual(['api_token.create', 'api_token.revoke']);
});

it('rejects a bad name or expiry', async () => {
  for (const payload of [{ name: '' }, { name: 'x', expiresInDays: 7 }, { name: 'x', extra: 1 }]) {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/integrations/tokens',
      headers: authHeaders(adminCookie),
      payload,
    });
    expect(res.statusCode).toBe(400);
  }
});

it('turns Claude access on and off (off by default) and audits it', async () => {
  const get = await t.app.inject({
    method: 'GET',
    url: '/api/integrations/mcp',
    headers: authHeaders(adminCookie),
  });
  expect(get.json()).toEqual({ enabled: false, endpointPath: '/mcp', publicUrl: null });
  const on = await t.app.inject({
    method: 'PATCH',
    url: '/api/integrations/mcp',
    headers: authHeaders(adminCookie),
    payload: { enabled: true },
  });
  expect(on.json().enabled).toBe(true);
  await t.app.inject({
    method: 'PATCH',
    url: '/api/integrations/mcp',
    headers: authHeaders(adminCookie),
    payload: { enabled: false },
  });
  const actions = (
    t.ctx.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'mcp.%'").all() as Array<{
      action: string;
    }>
  ).map((r) => r.action);
  expect(actions).toEqual(['mcp.enable', 'mcp.disable']);
});

/** Flattens Fastify's printRoutes() tree into `METHOD path` pairs (HEAD ignored). */
function registeredRoutes(tree: string): string[] {
  const found: string[] = [];
  const stack: string[] = [];
  for (const line of tree.split('\n')) {
    const m = /^((?:[│ ] {3})*)[├└]── (\S+) \(([^)]*)\)/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack[depth] = m[2]!;
    const path = stack.join('');
    for (const method of m[3]!.split(', ')) if (method !== 'HEAD') found.push(`${method} ${path}`);
  }
  return found;
}

it('lists every registered /api/integrations route in the table above', () => {
  const normalize = (path: string) => path.replace(/\/\d+(?=\/|$)/g, '/:id');
  const registered = registeredRoutes(t.app.printRoutes({ commonPrefix: false })).filter((r) =>
    /^\S+ \/api\/integrations(\/|$)/.test(r),
  );
  const table = ROUTES.map((r) => `${r.method} ${normalize(r.url)}`);
  expect(registered.filter((r) => !table.includes(r))).toEqual([]);
  expect(table.filter((r) => !registered.includes(r))).toEqual([]);
});

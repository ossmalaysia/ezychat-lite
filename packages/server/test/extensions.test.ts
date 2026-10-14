import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthResponse } from '@wa-team-inbox/shared';
import { requireUser, type ServerExtension } from '../src/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function demo(calls: string[]): ServerExtension {
  const migrationsDir = mkdtempSync(join(tmpdir(), 'wati-ext-'));
  writeFileSync(join(migrationsDir, '1_init.sql'), 'CREATE TABLE ent_demo (v TEXT);');
  return {
    name: 'demo',
    migrationsDir,
    init: (ctx) => {
      calls.push(`init:${Object.keys(ctx.services).includes('auth')}`);
    },
    routes: async (api, ctx) => {
      api.get('/ping', async () => ({ pong: true }));
      api.get('/auth/login', async () => ({ shadow: true }));
      api.post('/auth/login', async () => ({ shadow: true }));
      api.get('/private', { preHandler: requireUser(ctx) }, async () => ({ ok: true }));
      api.post('/echo', async (req) => ({ body: req.body }));
    },
  };
}

describe('server extensions', () => {
  it('reports lite with no extensions', async () => {
    t = await makeTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toMatchObject({ app: 'wa-team-inbox', edition: 'lite' });
    expect(HealthResponse.parse(res.json()).edition).toBe('lite');
    expect(t.ctx.extensions).toEqual([]);
  });

  it('applies migrations, runs init after core services and mounts routes under /api/ext/<name>', async () => {
    const calls: string[] = [];
    t = await makeTestApp({ edition: 'enterprise', extensions: [demo(calls)] });
    expect(calls).toEqual(['init:true']);
    expect(
      t.ctx.db.prepare("SELECT name FROM sqlite_master WHERE name = 'ent_demo'").get(),
    ).toBeTruthy();
    expect(
      t.ctx.db
        .prepare("SELECT version FROM extension_migrations WHERE extension = 'demo'")
        .pluck()
        .all(),
    ).toEqual([1]);
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({
      app: 'wa-team-inbox',
      edition: 'enterprise',
    });
    expect((await t.app.inject({ method: 'GET', url: '/api/ext/demo/ping' })).json()).toEqual({
      pong: true,
    });
  });

  it('cannot shadow a core route', async () => {
    t = await makeTestApp({ extensions: [demo([])] });
    expect((await t.app.inject({ method: 'GET', url: '/api/ext/demo/auth/login' })).json()).toEqual(
      { shadow: true },
    );
    const core = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'wrong-password' },
    });
    expect(core.body).not.toContain('shadow');
    expect(core.statusCode).not.toBe(200);
  });

  it('guards work in extension scopes', async () => {
    t = await makeTestApp({ extensions: [demo([])] });
    expect((await t.app.inject({ method: 'GET', url: '/api/ext/demo/private' })).statusCode).toBe(
      401,
    );
  });

  it('applies the Origin check to extension routes', async () => {
    t = await makeTestApp({ extensions: [demo([])] });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/ext/demo/echo',
      headers: { host: '127.0.0.1', origin: 'http://evil.example' },
      payload: { a: 1 },
    });
    expect(res.statusCode).toBe(403);
    const same = await t.app.inject({
      method: 'POST',
      url: '/api/ext/demo/echo',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      payload: { a: 1 },
    });
    expect(same.json()).toEqual({ body: { a: 1 } });
  });

  it('rejects an invalid extension list or edition before opening services', async () => {
    await expect(makeTestApp({ extensions: [{ name: 'Bad Name' }] })).rejects.toThrow(
      /extension name/,
    );
    await expect(makeTestApp({ edition: 'Enterprise!' })).rejects.toThrow(/edition/);
  });

  it('fails startup when an extension migration fails', async () => {
    const migrationsDir = mkdtempSync(join(tmpdir(), 'wati-ext-'));
    writeFileSync(join(migrationsDir, '1_bad.sql'), 'NOT SQL;');
    await expect(
      makeTestApp({ extensions: [{ name: 'broken', migrationsDir }] }),
    ).rejects.toThrow();
  });
});

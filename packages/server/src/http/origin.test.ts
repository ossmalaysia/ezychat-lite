import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { originHook } from './origin.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  app.addHook('onRequest', originHook);
  app.post('/api/thing', async () => ({ ok: true }));
  app.get('/api/thing', async () => ({ ok: true }));
  app.post('/other', async () => ({ ok: true }));
  await app.ready();
});
afterAll(() => app.close());

const host = 'localhost:7420';

describe('origin hook', () => {
  it('rejects POST with cookie and mismatched Origin', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/thing',
      headers: { host, origin: 'http://evil.com', cookie: 'sid=x' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: { code: 'bad_origin', message: expect.any(String) } });
  });
  it('accepts POST with matching Origin', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/thing',
      headers: { host, origin: 'http://localhost:7420', cookie: 'sid=x' },
    });
    expect(r.statusCode).toBe(200);
  });
  it('rejects POST with cookie but no Origin', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/thing', headers: { host, cookie: 'sid=x' } });
    expect(r.statusCode).toBe(403);
  });
  it('allows POST with no Origin and no cookie', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/thing', headers: { host } });
    expect(r.statusCode).toBe(200);
  });
  it('rejects mismatched Origin even without cookie', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/thing', headers: { host, origin: 'http://evil.com' } });
    expect(r.statusCode).toBe(403);
  });
  it('ignores GET and non-/api paths', async () => {
    const g = await app.inject({
      method: 'GET',
      url: '/api/thing',
      headers: { host, origin: 'http://evil.com', cookie: 'sid=x' },
    });
    expect(g.statusCode).toBe(200);
    const o = await app.inject({
      method: 'POST',
      url: '/other',
      headers: { host, origin: 'http://evil.com', cookie: 'sid=x' },
    });
    expect(o.statusCode).toBe(200);
  });
});

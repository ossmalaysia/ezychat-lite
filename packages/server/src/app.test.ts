import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp } from '../test/helpers.js';
import { HealthResponse } from '@wa-team-inbox/shared';
import { audit } from './db/audit.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('app', () => {
  it('GET /api/health', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    const body = HealthResponse.parse(r.json());
    expect(body.app).toBe('wa-team-inbox');
    expect(body.mode).toBe('dev');
  });

  it('unknown /api route -> 404 JSON error', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/x' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('sets security headers', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('same-origin');
  });

  it('settings store + secrets work', () => {
    t.ctx.settings.set('history_days', 30);
    expect(t.ctx.settings.get('history_days', 7)).toBe(30);
    expect(t.ctx.settings.get('missing', 'x')).toBe('x');
    t.ctx.settings.setSecret('tok', 'abc');
    expect(t.ctx.settings.getSecret('tok')).toBe('abc');
    const raw = t.ctx.db.prepare("SELECT value FROM settings WHERE key='tok'").get() as { value: string };
    expect(raw.value).not.toContain('abc');
    t.ctx.settings.setSecret('tok', null);
    expect(t.ctx.settings.getSecret('tok')).toBeNull();
  });

  it('audit writes a row', () => {
    audit(t.ctx.db, { userId: null, action: 'test.action', ip: '127.0.0.1', meta: { a: 1 } });
    const row = t.ctx.db.prepare("SELECT * FROM audit_log WHERE action='test.action'").get() as {
      meta: string;
      at: number;
    };
    expect(JSON.parse(row.meta)).toEqual({ a: 1 });
    expect(row.at).toBeGreaterThan(0);
  });
});

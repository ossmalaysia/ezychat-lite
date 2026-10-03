import { afterEach, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const headers = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const report = { kind: 'react', message: 'Cannot read properties of undefined', stack: 'at X', route: '/admin/quick-replies', appVersion: '0.1.0' };

describe('POST /api/client-errors', () => {
  it('accepts a report without a session (errors on the login page matter too)', async () => {
    t = await makeTestApp();
    const r = await t.app.inject({ method: 'POST', url: '/api/client-errors', headers, payload: report });
    expect(r.statusCode).toBe(204);
  });

  it('rejects malformed reports', async () => {
    t = await makeTestApp();
    const r = await t.app.inject({ method: 'POST', url: '/api/client-errors', headers, payload: { kind: 'nope', message: 'x', route: '/' } });
    expect(r.statusCode).toBe(400);
  });

  it('rate-limits per IP without failing the caller', async () => {
    t = await makeTestApp();
    const codes = new Set<number>();
    for (let i = 0; i < 35; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/api/client-errors', headers, payload: { ...report, message: `m${i}` } });
      codes.add(r.statusCode);
    }
    expect([...codes]).toEqual([204]);
  });
});

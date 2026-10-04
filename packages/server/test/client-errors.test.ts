import { afterEach, describe, expect, it } from 'vitest';
import { ClientErrorLimiter } from '../src/routes/client-errors.js';
import { makeTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const headers = {
  origin: 'http://localhost',
  host: 'localhost',
  'content-type': 'application/json',
};
const report = {
  kind: 'react',
  message: 'Cannot read properties of undefined',
  stack: 'at X',
  route: '/admin/quick-replies',
  appVersion: '0.1.0',
};

describe('POST /api/client-errors', () => {
  it('accepts a report without a session (errors on the login page matter too)', async () => {
    t = await makeTestApp();
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/client-errors',
      headers,
      payload: report,
    });
    expect(r.statusCode).toBe(204);
  });

  it('rejects malformed reports', async () => {
    t = await makeTestApp();
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/client-errors',
      headers,
      payload: { kind: 'nope', message: 'x', route: '/' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rate-limits per IP without failing the caller', async () => {
    t = await makeTestApp();
    const codes = new Set<number>();
    for (let i = 0; i < 35; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/api/client-errors',
        headers,
        payload: { ...report, message: `m${i}` },
      });
      codes.add(r.statusCode);
    }
    expect([...codes]).toEqual([204]);
  });
});

describe('ClientErrorLimiter', () => {
  it('allows a burst per IP, then drops until the window passes', () => {
    let now = 0;
    const limiter = new ClientErrorLimiter({
      windowMs: 1000,
      maxPerWindow: 2,
      maxTracked: 10,
      now: () => now,
    });
    expect([limiter.hit('a').allowed, limiter.hit('a').allowed, limiter.hit('a').allowed]).toEqual([
      true,
      true,
      false,
    ]);
    expect(limiter.hit('b').allowed).toBe(true);
    now = 1001;
    const next = limiter.hit('a');
    expect(next).toEqual({ allowed: true, droppedInPreviousWindow: 1 });
  });

  it('stays bounded when a public client rotates through many addresses', () => {
    let now = 0;
    const limiter = new ClientErrorLimiter({
      windowMs: 60_000,
      maxPerWindow: 30,
      maxTracked: 100,
      now: () => now,
    });
    for (let i = 0; i < 10_000; i++) {
      now = i; // every address is still inside its window
      limiter.hit(`2001:db8::${i.toString(16)}`);
    }
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it('forgets expired addresses before evicting live ones', () => {
    let now = 0;
    const limiter = new ClientErrorLimiter({
      windowMs: 1000,
      maxPerWindow: 1,
      maxTracked: 2,
      now: () => now,
    });
    limiter.hit('old');
    now = 2000;
    limiter.hit('live');
    expect(limiter.hit('live').allowed).toBe(false);
    limiter.hit('new'); // full: the expired 'old' entry goes first, 'live' keeps its count
    expect(limiter.size).toBe(2);
    expect(limiter.hit('live').allowed).toBe(false);
  });
});

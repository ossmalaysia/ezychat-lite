// The guarded fetch against a local https server (loopback allowed as in tests only): redirects,
// size cap, time limit, request bodies and empty answers.
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSelfSignedCert } from '../../../../../e2e/partner-mcp/cert.mjs';
import { guardedFetch, NetProbe, type NetPolicy } from './net.js';

let server: Server;
let origin: string;
let policy: NetPolicy;
const seen: Array<{ method: string; path: string; body: string; type: string }> = [];

beforeAll(async () => {
  const tls = generateSelfSignedCert();
  server = createServer({ cert: tls.cert, key: tls.key }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = req.url ?? '/';
      seen.push({
        method: req.method ?? '',
        path,
        body: Buffer.concat(chunks).toString(),
        type: req.headers['content-type'] ?? '',
      });
      if (path === '/same') return void res.writeHead(302, { location: '/ok' }).end();
      if (path === '/see-other') return void res.writeHead(303, { location: '/ok' }).end();
      if (path === '/away')
        return void res.writeHead(302, { location: 'https://example.com/' }).end();
      if (path === '/bad-location') return void res.writeHead(302, { location: 'http://[' }).end();
      if (path === '/loop') return void res.writeHead(307, { location: '/loop' }).end();
      if (path === '/empty') return void res.writeHead(204).end();
      if (path === '/big') return void res.writeHead(200).end('x'.repeat(5000));
      if (path === '/slow') return void setTimeout(() => res.writeHead(200).end('late'), 2000);
      if (path === '/auth')
        return void res.writeHead(401, { 'www-authenticate': 'Bearer' }).end('no');
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`ok ${req.method}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  policy = { allowLoopback: true, ca: tls.cert };
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('guardedFetch', () => {
  it('follows same-origin redirects only, a few hops at most', async () => {
    const fetchFn = guardedFetch(policy);
    expect(await (await fetchFn(`${origin}/same`)).text()).toBe('ok GET');
    const post = await fetchFn(`${origin}/see-other`, { method: 'POST', body: 'a=1' });
    expect(await post.text()).toBe('ok GET');
    await expect(fetchFn(`${origin}/away`)).rejects.toThrow(/redirect refused/);
    await expect(fetchFn(`${origin}/bad-location`)).rejects.toThrow(/redirect refused/);
    await expect(fetchFn(`${origin}/loop`)).rejects.toThrow(/redirect refused/);
    await expect(fetchFn(`${origin}/same`, { redirect: 'error' })).rejects.toThrow(
      /redirect refused/,
    );
    const manual = await fetchFn(`${origin}/same`, { redirect: 'manual' });
    expect([manual.status, manual.headers.get('location')]).toEqual([302, '/ok']);
  });

  it('sends string, form, byte and buffer bodies, and refuses others', async () => {
    const fetchFn = guardedFetch(policy);
    await fetchFn(`${origin}/echo`, { method: 'POST', body: new URLSearchParams({ a: '1' }) });
    await fetchFn(new URL(`${origin}/echo`), { method: 'POST', body: new Uint8Array([104, 105]) });
    await fetchFn(new Request(`${origin}/echo`), {
      method: 'POST',
      body: new Uint8Array([111, 107]).buffer,
    });
    expect(seen.slice(-3).map((s) => [s.body, s.type])).toEqual([
      ['a=1', 'application/x-www-form-urlencoded;charset=UTF-8'],
      ['hi', ''],
      ['ok', ''],
    ]);
    await expect(
      fetchFn(`${origin}/echo`, { method: 'POST', body: new Blob(['x']) }),
    ).rejects.toThrow(/unsupported/);
  });

  it('answers empty responses, records 401 challenges, caps size and time', async () => {
    const probe = new NetProbe();
    const fetchFn = guardedFetch({ ...policy, maxResponseBytes: 1000, timeoutMs: 300 }, probe);
    expect((await fetchFn(`${origin}/empty`)).status).toBe(204);
    expect((await fetchFn(`${origin}/ok`, { method: 'HEAD' })).status).toBe(200);
    await (await fetchFn(`${origin}/auth`)).text();
    expect([probe.lastStatus, probe.wwwAuthenticate]).toEqual([401, 'Bearer']);
    await expect((await fetchFn(`${origin}/big`)).text()).rejects.toThrow();
    expect(probe.tooLarge).toBe(true);
    await expect(fetchFn(`${origin}/slow`)).rejects.toThrow();
    expect(probe.timedOut).toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    await expect(fetchFn(`${origin}/ok`, { signal: aborted.signal })).rejects.toThrow();
    const closed = new NetProbe();
    await expect(guardedFetch(policy, closed)('https://127.0.0.1:1/')).rejects.toThrow();
    expect(closed.networkError).toBe(true);
    await expect(
      guardedFetch({ allowLoopback: false, resolve: async () => [] })(
        'https://partner.example.com/',
      ),
    ).rejects.toThrow(/no address/);
  });
});

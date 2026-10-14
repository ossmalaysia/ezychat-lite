import { describe, expect, it } from 'vitest';
import { probeServer } from './detect.js';
import { LITE_PRODUCT, defineProduct } from './product.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('probeServer', () => {
  it('returns mode and version for a WA Team Inbox server', async () => {
    let calledUrl = '';
    const r = await probeServer(7420, async (url) => {
      calledUrl = String(url);
      return jsonResponse({ app: 'wa-team-inbox', version: '1.2.3', mode: 'service' });
    });
    expect(calledUrl).toBe('http://127.0.0.1:7420/api/health');
    expect(r).toEqual({ mode: 'service', version: '1.2.3' });
  });

  it('returns null for a different app on the port', async () => {
    const r = await probeServer(7420, async () =>
      jsonResponse({ app: 'something-else', version: '1', mode: 'service' }),
    );
    expect(r).toBeNull();
  });

  it('returns null for an invalid mode', async () => {
    const r = await probeServer(7420, async () =>
      jsonResponse({ app: 'wa-team-inbox', version: '1', mode: 'weird' }),
    );
    expect(r).toBeNull();
  });

  it('returns null on non-2xx', async () => {
    const r = await probeServer(7420, async () => jsonResponse({ app: 'wa-team-inbox' }, 500));
    expect(r).toBeNull();
  });

  it('returns null on connection error', async () => {
    const r = await probeServer(7420, async () => {
      throw new TypeError('fetch failed');
    });
    expect(r).toBeNull();
  });

  it('returns null on timeout (aborts after 1.5s)', async () => {
    const started = Date.now();
    const r = await probeServer(
      7420,
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      50,
    );
    expect(r).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns null on non-JSON body', async () => {
    const r = await probeServer(7420, async () => new Response('<html>', { status: 200 }));
    expect(r).toBeNull();
  });
});

describe('probeServer editions', () => {
  const enterprise = defineProduct({
    ...LITE_PRODUCT,
    edition: 'enterprise',
    productName: 'EzyChat Enterprise',
    executableNames: ['EzyChat Enterprise'],
  });
  const answer = (body: unknown) => async () => jsonResponse(body);

  it('Lite adopts a server that says edition lite', async () => {
    const r = await probeServer(
      7420,
      answer({ app: 'wa-team-inbox', edition: 'lite', version: '1', mode: 'service' }),
      1500,
      LITE_PRODUCT,
    );
    expect(r).toEqual({ mode: 'service', version: '1' });
  });

  it('Lite adopts an older server without an edition field', async () => {
    const r = await probeServer(
      7420,
      answer({ app: 'wa-team-inbox', version: '1', mode: 'standalone' }),
      1500,
      LITE_PRODUCT,
    );
    expect(r).toEqual({ mode: 'standalone', version: '1' });
  });

  it('Lite never adopts an Enterprise server', async () => {
    const r = await probeServer(
      7420,
      answer({ app: 'wa-team-inbox', edition: 'enterprise', version: '1', mode: 'service' }),
      1500,
      LITE_PRODUCT,
    );
    expect(r).toBeNull();
  });

  it('Enterprise adopts only an Enterprise server', async () => {
    const ent = { app: 'wa-team-inbox', edition: 'enterprise', version: '2', mode: 'service' };
    expect(await probeServer(7420, answer(ent), 1500, enterprise)).toEqual({
      mode: 'service',
      version: '2',
    });
    const lite = { app: 'wa-team-inbox', edition: 'lite', version: '1', mode: 'service' };
    expect(await probeServer(7420, answer(lite), 1500, enterprise)).toBeNull();
    const legacy = { app: 'wa-team-inbox', version: '1', mode: 'service' };
    expect(await probeServer(7420, answer(legacy), 1500, enterprise)).toBeNull();
  });

  it('rejects a non-string edition', async () => {
    const r = await probeServer(
      7420,
      answer({ app: 'wa-team-inbox', edition: 1, version: '1', mode: 'service' }),
      1500,
      LITE_PRODUCT,
    );
    expect(r).toBeNull();
  });
});

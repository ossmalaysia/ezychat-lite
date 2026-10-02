import { describe, expect, it } from 'vitest';
import { probeServer } from './detect.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
    const r = await probeServer(7420, async () => jsonResponse({ app: 'something-else', version: '1', mode: 'service' }));
    expect(r).toBeNull();
  });

  it('returns null for an invalid mode', async () => {
    const r = await probeServer(7420, async () => jsonResponse({ app: 'wa-team-inbox', version: '1', mode: 'weird' }));
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

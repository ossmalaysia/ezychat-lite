import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, api } from './client';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api()', () => {
  it('throws ApiError with code and message from the JSON error body', async () => {
    mockFetch(409, { error: { code: 'conflict', message: 'Username taken' } });
    const err = await api('/users', { method: 'POST', body: { username: 'x' } }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe('conflict');
    expect((err as ApiError).message).toBe('Username taken');
  });

  it('prefixes /api, sends JSON and same-origin credentials', async () => {
    const fn = mockFetch(200, { ok: true });
    await api('/auth/login', { method: 'POST', body: { username: 'a', password: 'b' } });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ username: 'a', password: 'b' }));
  });

  it('validates the response with a schema when given', async () => {
    mockFetch(200, { needsSetup: true });
    const res = await api('/setup/status', { schema: z.object({ needsSetup: z.boolean() }) });
    expect(res.needsSetup).toBe(true);
  });

  it('dispatches wati:unauthorized on 401', async () => {
    mockFetch(401, { error: { code: 'unauthorized', message: 'Login required' } });
    const listener = vi.fn();
    window.addEventListener('wati:unauthorized', listener);
    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
    window.removeEventListener('wati:unauthorized', listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic error when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('oops', { status: 502 })),
    );
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('http_502');
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});

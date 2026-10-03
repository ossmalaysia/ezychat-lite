import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_VERSION, useAppVersion } from './version';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAppVersion', () => {
  it('injects the build version', () => {
    expect(BUILD_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('falls back to the build version while loading, then returns the server version', async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    const { result } = renderHook(() => useAppVersion(), { wrapper: wrapper() });
    expect(result.current).toBe(BUILD_VERSION);
    resolve(
      new Response(JSON.stringify({ app: 'wa-team-inbox', version: '9.8.7', mode: 'dev' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await waitFor(() => expect(result.current).toBe('9.8.7'));
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('keeps the build version when the health request fails', async () => {
    const fetchMock = mockFetch(async () => new Response('nope', { status: 500 }));
    const { result } = renderHook(() => useAppVersion(), { wrapper: wrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBe(BUILD_VERSION);
  });
});

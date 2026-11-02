import { describe, expect, it, vi } from 'vitest';
import { createWaVersionSource, type WaVersion } from './wa-version.js';

const V: WaVersion = [2, 3000, 1];

describe('createWaVersionSource', () => {
  it('falls back to the bundled version when the lookup never answers', async () => {
    vi.useFakeTimers();
    try {
      const src = createWaVersionSource({
        fetchLatest: () => new Promise(() => {}),
        timeoutMs: 5_000,
      });
      const pending = src.get();
      await vi.advanceTimersByTimeAsync(5_000);
      const r = await pending;
      expect(r.version).toBeUndefined();
      expect(String(r.error)).toMatch(/timed out after 5000 ms/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses a fetched version until it expires', async () => {
    let t = 0;
    const fetchLatest = vi.fn(async () => ({ version: V }));
    const src = createWaVersionSource({ fetchLatest, ttlMs: 1_000, now: () => t });
    expect(await src.get()).toEqual({ version: V });
    t = 999;
    expect(await src.get()).toEqual({ version: V });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    t = 1_000;
    await src.get();
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('shares one lookup between concurrent connects', async () => {
    let resolve!: (v: { version: WaVersion }) => void;
    const fetchLatest = vi.fn(() => new Promise<{ version: WaVersion }>((r) => (resolve = r)));
    const src = createWaVersionSource({ fetchLatest });
    const a = src.get();
    const b = src.get();
    resolve({ version: V });
    expect(await a).toEqual({ version: V });
    expect(await b).toEqual({ version: V });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('after a failure skips the lookup for a while and keeps the last good version', async () => {
    let t = 0;
    const fetchLatest = vi
      .fn<() => Promise<{ version: WaVersion }>>()
      .mockResolvedValueOnce({ version: V })
      .mockRejectedValue(new Error('offline'));
    const src = createWaVersionSource({ fetchLatest, ttlMs: 10, failureTtlMs: 100, now: () => t });
    await src.get();
    t = 10;
    const failed = await src.get();
    expect(failed.version).toEqual(V);
    expect((failed.error as Error).message).toBe('offline');
    t = 50;
    expect(await src.get()).toEqual({ version: V });
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    t = 110;
    await src.get();
    expect(fetchLatest).toHaveBeenCalledTimes(3);
  });
});

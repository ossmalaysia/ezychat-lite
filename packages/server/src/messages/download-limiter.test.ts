import { describe, expect, it } from 'vitest';
import { DownloadLimiter } from './download-limiter.js';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setImmediate(r));

describe('DownloadLimiter', () => {
  it('runs at most `concurrency` tasks at once, in FIFO order', async () => {
    const lim = new DownloadLimiter({ concurrency: 2, timeoutMs: 10_000 });
    const ds = [deferred<number>(), deferred<number>(), deferred<number>()];
    const started: number[] = [];
    const results = ds.map((d, i) =>
      lim.run(() => {
        started.push(i);
        return d.promise;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    ds[0]!.resolve(0);
    await tick();
    expect(started).toEqual([0, 1, 2]);
    ds[1]!.reject(new Error('boom'));
    ds[2]!.resolve(2);
    await expect(results[0]).resolves.toBe(0);
    await expect(results[1]).rejects.toThrow('boom');
    await expect(results[2]).resolves.toBe(2);
    expect(lim.active).toBe(0);
  });

  it('rejects a task that exceeds the timeout and frees its slot', async () => {
    const lim = new DownloadLimiter({ concurrency: 1, timeoutMs: 20 });
    const never = lim.run(() => new Promise<number>(() => undefined));
    const next = lim.run(async () => 7);
    await expect(never).rejects.toThrow(/timed out/);
    await expect(next).resolves.toBe(7);
  });

  it('a synchronous throw becomes a rejection', async () => {
    const lim = new DownloadLimiter({ concurrency: 1, timeoutMs: 1000 });
    await expect(
      lim.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await expect(lim.run(async () => 1)).resolves.toBe(1);
  });
});

import { expect, it } from 'vitest';
import { WindowLimiter } from './window-limiter.js';

it('allows max hits per window per key, then says when to retry', () => {
  let now = 1_000_000;
  const limiter = new WindowLimiter({ windowMs: 60_000, max: 2, now: () => now });
  expect(limiter.hit('1')).toEqual({ allowed: true, retryAfterSec: 0 });
  expect(limiter.hit('1').allowed).toBe(true);
  now += 15_000;
  expect(limiter.hit('1')).toEqual({ allowed: false, retryAfterSec: 45 });
  expect(limiter.hit('2').allowed).toBe(true);
  now += 45_000;
  expect(limiter.hit('1').allowed).toBe(true);
});

it('keeps memory bounded by forgetting the oldest key', () => {
  const limiter = new WindowLimiter({ windowMs: 60_000, max: 1, maxKeys: 2, now: () => 0 });
  limiter.hit('a');
  limiter.hit('b');
  limiter.hit('c');
  expect(limiter.size).toBe(2);
});

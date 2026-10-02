import { describe, it, expect } from 'vitest';
import { LoginRateLimiter } from './rate-limit.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('LoginRateLimiter', () => {
  it('locks a username for 15 min after 5 failures', () => {
    const c = clock();
    const rl = new LoginRateLimiter(c.now);
    for (let i = 0; i < 5; i++) {
      expect(rl.check('alice', `10.0.0.${i}`).ok).toBe(true);
      rl.recordFailure('alice', `10.0.0.${i}`);
    }
    const r = rl.check('alice', '10.0.0.99');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBeGreaterThan(14 * 60);
    // case-insensitive username
    expect(rl.check('ALICE', '10.0.0.98').ok).toBe(false);
    // other users unaffected
    expect(rl.check('bob', '10.0.0.97').ok).toBe(true);
    c.advance(15 * 60 * 1000 + 1);
    expect(rl.check('alice', '10.0.0.96').ok).toBe(true);
  });

  it('failures older than 15 min do not count', () => {
    const c = clock();
    const rl = new LoginRateLimiter(c.now);
    for (let i = 0; i < 4; i++) rl.recordFailure('alice', '1.1.1.1');
    c.advance(16 * 60 * 1000);
    rl.recordFailure('alice', '1.1.1.1');
    expect(rl.check('alice', '1.1.1.2').ok).toBe(true);
  });

  it('recordSuccess clears username failures', () => {
    const rl = new LoginRateLimiter(clock().now);
    for (let i = 0; i < 4; i++) rl.recordFailure('alice', '1.1.1.1');
    rl.recordSuccess('alice');
    rl.recordFailure('alice', '1.1.1.1');
    expect(rl.check('alice', '1.1.1.3').ok).toBe(true);
  });

  it('allows 20 attempts per IP per 60s', () => {
    const c = clock();
    const rl = new LoginRateLimiter(c.now);
    for (let i = 0; i < 20; i++) expect(rl.check(`u${i}`, '9.9.9.9').ok).toBe(true);
    const r = rl.check('u20', '9.9.9.9');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(rl.check('u21', '9.9.9.8').ok).toBe(true);
    c.advance(60_001);
    expect(rl.check('u22', '9.9.9.9').ok).toBe(true);
  });
});

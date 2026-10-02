import { describe, expect, it } from 'vitest';
import { backoffMs, classifyDisconnect } from './disconnect.js';

describe('classifyDisconnect', () => {
  it.each([
    [401, 'logged_out'],
    [440, 'replaced'],
    [500, 'bad_session'],
    [403, 'blocked'],
    [411, 'blocked'],
    [515, 'reconnect'],
    [408, 'reconnect'],
    [428, 'reconnect'],
    [503, 'reconnect'],
    [undefined, 'reconnect'],
    [999, 'reconnect'],
  ] as const)('maps %s -> %s', (code, action) => {
    expect(classifyDisconnect(code)).toBe(action);
  });
});

describe('backoffMs', () => {
  it('attempt 0 is 2s +/- 20%', () => {
    expect(backoffMs(0, () => 0)).toBe(1600);
    expect(backoffMs(0, () => 1)).toBe(2400);
    for (let i = 0; i < 50; i++) {
      const v = backoffMs(0);
      expect(v).toBeGreaterThanOrEqual(1600);
      expect(v).toBeLessThanOrEqual(2400);
    }
  });
  it('caps at 60s +/- 20%', () => {
    expect(backoffMs(10, () => 0)).toBe(48000);
    expect(backoffMs(10, () => 1)).toBe(72000);
    for (let i = 0; i < 50; i++) {
      const v = backoffMs(10);
      expect(v).toBeGreaterThanOrEqual(48000);
      expect(v).toBeLessThanOrEqual(72000);
    }
  });
  it('grows exponentially', () => {
    expect(backoffMs(2, () => 0.5)).toBe(8000);
  });
});

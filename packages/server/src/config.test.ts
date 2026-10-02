import { describe, expect, it } from 'vitest';
import { parseArgs } from './config.js';

describe('parseArgs fake-wa', () => {
  it('enables fake WA only with the explicit flag', () => {
    expect(parseArgs(['--data', 'x', '--fake-wa'], {}).fakeWa).toBe(true);
    expect(parseArgs(['--data', 'x'], {}).fakeWa).toBe(false);
  });
  it('ignores a WATI_FAKE_WA environment variable', () => {
    expect(parseArgs(['--data', 'x'], { WATI_FAKE_WA: '1' }).fakeWa).toBe(false);
  });
  it('refuses --fake-wa in service mode', () => {
    expect(() => parseArgs(['--data', 'x', '--mode', 'service', '--fake-wa'], {})).toThrow(/service/);
  });
});

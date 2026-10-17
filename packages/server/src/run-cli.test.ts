import { describe, expect, it, vi } from 'vitest';
import { runCli } from './run-cli.js';

describe('runCli', () => {
  it('exits 2 with usage when --data is missing', async () => {
    const exit = vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }) as unknown as (code: number) => never;
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(runCli([], {}, { exit })).rejects.toThrow('exit 2');
      expect(err.mock.calls.join('')).toContain('Usage: server --data <dir>');
    } finally {
      err.mockRestore();
    }
  });
});

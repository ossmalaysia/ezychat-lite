import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_TARGETS,
  CODEX_VERSION,
  fetchCodexTarget,
  verifiedCodexBinary,
  fetchCodexLegal,
} from './fetch-codex.mjs';

describe('pinned official Codex helper', () => {
  it('pins all supported installers and development Linux to verified archives', () => {
    expect(CODEX_VERSION).toBe('0.114.0');
    expect(Object.keys(CODEX_TARGETS)).toEqual([
      'win32-x64',
      'darwin-x64',
      'darwin-arm64',
      'linux-x64',
    ]);
    for (const target of Object.values(CODEX_TARGETS)) {
      expect(target.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(target.asset).toMatch(/^codex-.*\.tar\.gz$/);
    }
  });
  it('rejects corrupted archives before extracting or writing anything', () => {
    expect(() =>
      verifiedCodexBinary(Buffer.from('tampered helper'), CODEX_TARGETS['win32-x64']),
    ).toThrow('Checksum mismatch');
  });
  it('rejects unsupported platforms before downloading', async () => {
    await expect(fetchCodexTarget('untrusted-target')).rejects.toThrow('Unsupported');
  });
  it('verifies bundled upstream legal notices before writing them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-legal-'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('tampered legal notice')));
    try {
      await expect(fetchCodexLegal(dir)).rejects.toThrow('Checksum mismatch for Codex LICENSE');
      expect(existsSync(join(dir, 'LICENSE'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyRuntimeVersion,
  isShutdownMessage,
  prepareServerArgs,
  SHUTDOWN_MESSAGE,
} from './server-host.cjs';

const base = ['--data', 'D:\\data', '--port', '7420', '--mode', 'standalone'];

it('reports the updated runtime rather than the old version saved in service configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wati-runtime-version-'));
  try {
    mkdirSync(join(dir, 'server'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.1.14' }));
    const env = { WATI_VERSION: '0.1.13', WATI_PORT_FILE: 'unchanged' };
    applyRuntimeVersion(join(dir, 'server', 'server.cjs'), env);
    expect(env).toEqual({ WATI_VERSION: '0.1.14', WATI_PORT_FILE: 'unchanged' });
    rmSync(join(dir, 'package.json'));
    env.WATI_VERSION = 'development';
    applyRuntimeVersion(join(dir, 'server', 'server.cjs'), env);
    expect(env.WATI_VERSION).toBe('development');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('prepareServerArgs (persisted port setting wins over --port)', () => {
  it('replaces --port with the persisted setting', () => {
    const r = prepareServerArgs(base, () => 8123);
    expect(r.port).toBe(8123);
    expect(r.args).toEqual(['--data', 'D:\\data', '--port', '8123', '--mode', 'standalone']);
  });
  it('reads the setting from the --data dir', () => {
    let seen = '';
    prepareServerArgs(base, (d) => {
      seen = d;
      return null;
    });
    expect(seen).toBe('D:\\data');
  });
  it('keeps --port when no setting exists', () => {
    const r = prepareServerArgs(base, () => null);
    expect(r.port).toBe(7420);
    expect(r.args).toEqual(base);
  });
  it('keeps --port when reading the db fails (fresh install, no app.db)', () => {
    const r = prepareServerArgs(base, () => {
      throw new Error('SQLITE_CANTOPEN');
    });
    expect(r.port).toBe(7420);
  });
  it('ignores invalid settings', () => {
    expect(prepareServerArgs(base, () => 70000).port).toBe(7420);
  });
  it('adds --port when absent', () => {
    const r = prepareServerArgs(['--data', 'x'], () => 9000);
    expect(r.args).toEqual(['--data', 'x', '--port', '9000']);
  });
  it('leaves --reset-admin runs untouched', () => {
    const args = ['--data', 'x', '--reset-admin'];
    expect(prepareServerArgs(args, () => 9000)).toEqual({ args, port: null });
  });
});

describe('isShutdownMessage', () => {
  it('accepts the raw string (node IPC) and a MessageEvent-like object (utilityProcess)', () => {
    expect(isShutdownMessage(SHUTDOWN_MESSAGE)).toBe(true);
    expect(isShutdownMessage({ data: SHUTDOWN_MESSAGE })).toBe(true);
    expect(isShutdownMessage('other')).toBe(false);
    expect(isShutdownMessage(null)).toBe(false);
  });
});

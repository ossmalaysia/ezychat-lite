import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  applyRuntimeVersion,
  isShutdownMessage,
  pickFreePort,
  PORT_TRIES,
  portIsFree,
  prepareServerArgs,
  SHUTDOWN_MESSAGE,
  startArgs,
  useFreePort,
  withPort,
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

describe('pickFreePort (a taken port moves the server to the next free one)', () => {
  it('keeps a free port', async () => {
    expect(await pickFreePort(7440, async () => true)).toBe(7440);
  });
  it('moves to the first free port after a taken one', async () => {
    const taken = new Set([7440, 7441]);
    const tried: number[] = [];
    const port = await pickFreePort(7440, async (p) => {
      tried.push(p);
      return !taken.has(p);
    });
    expect(port).toBe(7442);
    expect(tried).toEqual([7440, 7441, 7442]);
  });
  it(`gives up after ${PORT_TRIES} ports and keeps the chosen one, so the server reports the error`, async () => {
    let calls = 0;
    const port = await pickFreePort(7440, async () => {
      calls++;
      return false;
    });
    expect(port).toBe(7440);
    expect(calls).toBe(PORT_TRIES);
  });
  it('never tries a port above 65535', async () => {
    const tried: number[] = [];
    await pickFreePort(65534, async (p) => {
      tried.push(p);
      return false;
    });
    expect(tried).toEqual([65534, 65535]);
  });
});

describe('portIsFree', () => {
  it('sees a port held by another listener as taken, and free again after it closes', async () => {
    const holder = createServer();
    await new Promise<void>((done) => holder.listen(0, '127.0.0.1', done));
    const { port } = holder.address() as AddressInfo;
    try {
      expect(await portIsFree(port)).toBe(false);
    } finally {
      await new Promise<void>((done) => holder.close(() => done()));
    }
    expect(await portIsFree(port)).toBe(true);
  });
});

describe('useFreePort', () => {
  it('moves the server args to the free port and says so', async () => {
    const r = await useFreePort({ args: [...base], port: 7420 }, async () => 7423);
    expect(r).toEqual({
      args: ['--data', 'D:\\data', '--port', '7423', '--mode', 'standalone'],
      port: 7423,
      moved: 'port 7420 is in use; using port 7423',
    });
  });
  it('changes nothing when the port is free or unknown (--reset-admin)', async () => {
    const pick = async (p: number) => p;
    expect(await useFreePort({ args: [...base], port: 7420 }, pick)).toEqual({
      args: base,
      port: 7420,
      moved: null,
    });
    let called = false;
    const none = await useFreePort({ args: ['--reset-admin'], port: null }, async (p) => {
      called = true;
      return p;
    });
    expect(none).toEqual({ args: ['--reset-admin'], port: null, moved: null });
    expect(called).toBe(false);
  });
});

describe('startArgs', () => {
  it('applies the saved setting, then moves a taken port and logs it once', async () => {
    const lines: string[] = [];
    const r = await startArgs(
      base,
      () => 7440,
      async () => 7441,
      (l) => lines.push(l),
    );
    expect(r).toEqual({
      args: ['--data', 'D:\\data', '--port', '7441', '--mode', 'standalone'],
      port: 7441,
    });
    expect(lines).toEqual(['server-host: port 7440 is in use; using port 7441']);
  });
  it('logs nothing when the port is free', async () => {
    const lines: string[] = [];
    const r = await startArgs(
      base,
      () => null,
      async (p) => p,
      (l) => lines.push(l),
    );
    expect(r).toEqual({ args: base, port: 7420 });
    expect(lines).toEqual([]);
  });
});

describe('withPort', () => {
  it('replaces --port or adds it', () => {
    expect(withPort(base, 7441)).toEqual([
      '--data',
      'D:\\data',
      '--port',
      '7441',
      '--mode',
      'standalone',
    ]);
    expect(withPort(['--data', 'x'], 7441)).toEqual(['--data', 'x', '--port', '7441']);
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

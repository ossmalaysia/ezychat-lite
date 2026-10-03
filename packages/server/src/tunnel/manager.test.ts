import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { spawn as spawnFn } from 'node:child_process';
import type { TunnelStatus } from '@wa-team-inbox/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../bus.js';
import { SecretBox } from '../crypto/secret.js';
import { openDb, type DB } from '../db/index.js';
import { SettingsStore } from '../db/settings.js';
import { silentLogger } from '../logger.js';
import { TunnelManager } from './manager.js';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.exit(null, 'SIGTERM'));
    return true;
  }
  exit(code: number | null, signal: string | null = null) {
    if (this.exitCode !== null) return;
    this.exitCode = code ?? -1;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
  line(text: string, stream: 'stdout' | 'stderr' = 'stderr') {
    this[stream].write(text + '\n');
  }
}

let dir: string;
let db: DB;
let settings: SettingsStore;
let bus: Bus;
let now: number;
let children: FakeChild[];
let calls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }>;
let statuses: TunnelStatus[];

function makeManager(bin: string | null = '/bin/cloudflared', log = silentLogger()) {
  const spawn = ((cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: opts?.env });
    const c = new FakeChild();
    children.push(c);
    return c;
  }) as unknown as typeof spawnFn;
  return new TunnelManager({
    spawn,
    binPath: () => bin,
    port: () => 7420,
    settings,
    bus,
    log,
    now: () => now,
  });
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wati-tunnel-'));
  db = openDb(join(dir, 'app.db'));
  settings = new SettingsStore(db, SecretBox.loadOrCreate(join(dir, 'secret.key')));
  bus = new Bus();
  statuses = [];
  bus.on('tunnel:status', (s) => statuses.push(s));
  now = 1_000_000;
  children = [];
  calls = [];
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('TunnelManager', () => {
  it('starts a quick tunnel and parses the URL from stderr', async () => {
    const m = makeManager();
    const s0 = await m.start({ mode: 'quick' }, 1);
    expect(s0.state).toBe('starting');
    expect(calls[0]).toMatchObject({
      cmd: '/bin/cloudflared',
      args: ['tunnel', '--config=', '--no-autoupdate', '--url', 'http://127.0.0.1:7420'],
    });
    expect(calls[0]!.env?.TUNNEL_TOKEN).toBeUndefined();
    children[0]!.line('INF Requesting new quick Tunnel on trycloudflare.com...');
    children[0]!.line('INF |  https://abc-def.trycloudflare.com  |');
    await flush();
    expect(m.status()).toMatchObject({
      state: 'starting',
      url: 'https://abc-def.trycloudflare.com',
    });
    children[0]!.line('INF Registered tunnel connection connIndex=0 location=sin01');
    await flush();
    const s = m.status();
    expect(s).toMatchObject({
      mode: 'quick',
      state: 'running',
      url: 'https://abc-def.trycloudflare.com',
    });
    expect(s.logTail.length).toBe(3);
    expect(statuses.at(-1)?.state).toBe('running');
    expect(settings.get('tunnel_mode', 'off')).toBe('quick');
    await m.shutdown();
  });

  it('waits for both the quick URL and edge registration when streams arrive in reverse order', async () => {
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    children[0]!.line('INF Registered tunnel connection connIndex=0 location=sin01', 'stdout');
    await flush();
    expect(m.status()).toMatchObject({ state: 'starting', url: null });
    children[0]!.line('INF | https://abc-def.trycloudflare.com |');
    await flush();
    expect(m.status()).toMatchObject({
      state: 'running',
      url: 'https://abc-def.trycloudflare.com',
    });
    await m.shutdown();
  });

  it('isolates quick and token-managed named tunnels from unrelated default configuration', async () => {
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    expect(calls[0]!.args).toContain('--config=');
    await m.start({ mode: 'named', token: 'test-named-token' }, 1);
    expect(calls[1]!.args).toContain('--config=');
    expect(calls[1]!.args).not.toContain('--url');
    expect(calls[1]!.env?.TUNNEL_TOKEN).toBe('test-named-token');
    await m.shutdown();
  });

  it('logs the intended origin and connectivity milestones without copying raw tunnel output', async () => {
    const log = silentLogger();
    const info = vi.spyOn(log, 'info');
    const warn = vi.spyOn(log, 'warn');
    const m = makeManager('/bin/cloudflared', log);
    await m.start({ mode: 'quick' }, 1);
    expect(info).toHaveBeenCalledWith(
      {
        mode: 'quick',
        bin: '/bin/cloudflared',
        localOrigin: 'http://127.0.0.1:7420',
        configIsolated: true,
      },
      'cloudflared started',
    );
    children[0]!.line('INF | https://abc-def.trycloudflare.com |');
    children[0]!.line('INF Registered tunnel connection connIndex=0 location=sin01');
    children[0]!.line('ERR Unable to reach the origin service token=private-test-value');
    await flush();
    expect(info).toHaveBeenCalledWith(
      {
        mode: 'quick',
        url: 'https://abc-def.trycloudflare.com',
        localOrigin: 'http://127.0.0.1:7420',
      },
      'Tunnel connected to Cloudflare',
    );
    expect(warn).toHaveBeenCalledWith(
      { mode: 'quick', localOrigin: 'http://127.0.0.1:7420' },
      'Tunnel cannot reach its local origin',
    );
    expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain(
      'private-test-value',
    );
    await m.shutdown();
  });

  it('named tunnel runs after registration line and stores token encrypted', async () => {
    const m = makeManager();
    const token = 'eyJhIjoic2VjcmV0LXRva2VuLXZhbHVlIn0';
    await m.start({ mode: 'named', token, hostname: 'inbox.example.com' }, 1);
    // token passed via env, never on the command line
    expect(calls[0]!.args).toEqual(['tunnel', '--config=', '--no-autoupdate', 'run']);
    expect(calls[0]!.args.join(' ')).not.toContain(token);
    expect(calls[0]!.env?.TUNNEL_TOKEN).toBe(token);
    children[0]!.line('INF Registered tunnel connection connIndex=0 location=sin01', 'stdout');
    await flush();
    expect(m.status()).toMatchObject({
      mode: 'named',
      state: 'running',
      hostname: 'inbox.example.com',
    });
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'tunnel_token'").get() as {
      value: string;
    };
    expect(raw.value).not.toContain(token);
    expect(settings.getSecret('tunnel_token')).toBe(token);
    await m.shutdown();
  });

  it('named tunnel without a token is rejected', async () => {
    const m = makeManager();
    await expect(m.start({ mode: 'named' }, 1)).rejects.toThrow(/token/i);
    expect(calls.length).toBe(0);
  });

  it('restarts with backoff after an unexpected exit', async () => {
    vi.useFakeTimers();
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    now += 60_000; // ran long enough: not a "fast" failure
    children[0]!.exit(1);
    expect(m.status().state).toBe('starting');
    expect(calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.length).toBe(2);
    await m.shutdown();
  });

  it('5 consecutive fast crashes -> error state with lastError', async () => {
    vi.useFakeTimers();
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    for (let i = 0; i < 5; i++) {
      children.at(-1)!.line(`ERR crash ${i}`);
      await vi.advanceTimersByTimeAsync(0);
      now += 1000;
      children.at(-1)!.exit(1);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(calls.length).toBe(5);
    const s = m.status();
    expect(s.state).toBe('error');
    expect(s.lastError).toBeTruthy();
    expect(s.logTail.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.length).toBe(5);
  });

  it('slow crashes (never running) still reach error after 5 consecutive failures', async () => {
    vi.useFakeTimers();
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    for (let i = 0; i < 5; i++) {
      now += 45_000; // each run lasts > 30s but never registers
      children.at(-1)!.exit(1);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(m.status().state).toBe('error');
    expect(calls.length).toBe(5);
  });

  it('backoff keeps growing to a 60s cap for a tunnel that runs briefly then dies', async () => {
    vi.useFakeTimers();
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    const delays: number[] = [];
    for (let i = 0; i < 9; i++) {
      children.at(-1)!.line('INF |  https://abc-def.trycloudflare.com  |');
      children.at(-1)!.line('INF Registered tunnel connection connIndex=0 location=sin01');
      await vi.advanceTimersByTimeAsync(0);
      expect(m.status().state).toBe('running');
      now += 40_000; // stable enough to reset the failure count, not the backoff
      children.at(-1)!.exit(1);
      const before = calls.length;
      let waited = 0;
      while (calls.length === before && waited < 120_000) {
        await vi.advanceTimersByTimeAsync(1000);
        waited += 1000;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(m.status().state).not.toBe('error');
    await m.shutdown();
  });

  it('stop kills the child and sets mode off / state stopped', async () => {
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    const child = children[0]!;
    const s = await m.stop(1);
    expect(child.killed).toBe(true);
    expect(s).toMatchObject({ mode: 'off', state: 'stopped', url: null });
    expect(settings.get('tunnel_mode', 'x')).toBe('off');
    await flush();
    expect(calls.length).toBe(1); // no restart after intentional stop
  });

  it('missing binary -> error cloudflared not found', async () => {
    const m = makeManager(null);
    const s = await m.start({ mode: 'quick' }, 1);
    expect(s.state).toBe('error');
    expect(s.lastError).toMatch(/cloudflared not found/);
  });

  it('restore starts the previously persisted mode', async () => {
    settings.set('tunnel_mode', 'quick');
    const m = makeManager();
    await m.restore();
    expect(calls.length).toBe(1);
    expect(m.status().mode).toBe('quick');
    await m.shutdown();
    // shutdown keeps the persisted mode for the next server start
    expect(settings.get('tunnel_mode', 'off')).toBe('quick');
  });

  it('restore with mode off does nothing', async () => {
    const m = makeManager();
    await m.restore();
    expect(calls.length).toBe(0);
    expect(m.status()).toMatchObject({ mode: 'off', state: 'stopped' });
  });

  it('keeps only the last 50 log lines', async () => {
    const m = makeManager();
    await m.start({ mode: 'quick' }, 1);
    for (let i = 0; i < 60; i++) children[0]!.line(`line ${i}`);
    await flush();
    const tail = m.status().logTail;
    expect(tail.length).toBe(50);
    expect(tail.at(-1)).toBe('line 59');
    await m.shutdown();
  });
});

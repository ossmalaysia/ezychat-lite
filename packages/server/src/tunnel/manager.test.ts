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
let calls: Array<{ cmd: string; args: string[] }>;
let statuses: TunnelStatus[];

function makeManager(bin: string | null = '/bin/cloudflared') {
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
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
    log: silentLogger(),
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
    expect(calls[0]).toEqual({
      cmd: '/bin/cloudflared',
      args: ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:7420'],
    });
    children[0]!.line('INF Requesting new quick Tunnel on trycloudflare.com...');
    children[0]!.line('INF |  https://abc-def.trycloudflare.com  |');
    await flush();
    const s = m.status();
    expect(s).toMatchObject({ mode: 'quick', state: 'running', url: 'https://abc-def.trycloudflare.com' });
    expect(s.logTail.length).toBe(2);
    expect(statuses.at(-1)?.state).toBe('running');
    expect(settings.get('tunnel_mode', 'off')).toBe('quick');
    await m.shutdown();
  });

  it('named tunnel runs after registration line and stores token encrypted', async () => {
    const m = makeManager();
    const token = 'eyJhIjoic2VjcmV0LXRva2VuLXZhbHVlIn0';
    await m.start({ mode: 'named', token, hostname: 'inbox.example.com' }, 1);
    expect(calls[0]!.args).toEqual(['tunnel', '--no-autoupdate', 'run', '--token', token]);
    children[0]!.line('INF Registered tunnel connection connIndex=0 location=sin01', 'stdout');
    await flush();
    expect(m.status()).toMatchObject({ mode: 'named', state: 'running', hostname: 'inbox.example.com' });
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'tunnel_token'").get() as { value: string };
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

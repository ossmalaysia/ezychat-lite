import type { ChildProcess, spawn as spawnFn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { TunnelMode, TunnelStartBody, TunnelStatus } from '@wa-team-inbox/shared';
import type { Logger } from 'pino';
import type { Bus } from '../bus.js';
import type { SettingsStore } from '../db/settings.js';
import { errors } from '../http/errors.js';
import { isNamedTunnelRegistered, parseQuickTunnelUrl } from './parse.js';

export interface TunnelService {
  status(): TunnelStatus;
  start(body: TunnelStartBody, actorId: number): Promise<TunnelStatus>;
  stop(actorId: number): Promise<TunnelStatus>;
  restore(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface TunnelManagerDeps {
  spawn: typeof spawnFn;
  binPath: () => string | null;
  port: () => number;
  settings: SettingsStore;
  bus: Bus;
  log: Logger;
  now?: () => number;
  setTimeout?: typeof setTimeout;
}

/** Settings keys owned by the tunnel manager. */
export const TUNNEL_MODE_KEY = 'tunnel_mode';
export const TUNNEL_TOKEN_KEY = 'tunnel_token';
export const TUNNEL_HOSTNAME_KEY = 'named_tunnel_hostname';

const LOG_TAIL = 50;
const FAST_EXIT_MS = 30_000;
const MAX_FAST_FAILURES = 5;
const MAX_BACKOFF_MS = 60_000;
const KILL_WAIT_MS = 5_000;

type ActiveMode = Exclude<TunnelMode, 'off'>;

/** Supervises a cloudflared child process (quick or named tunnel). */
export class TunnelManager implements TunnelService {
  private mode: TunnelMode = 'off';
  private state: TunnelStatus['state'] = 'stopped';
  private url: string | null = null;
  private lastError: string | null = null;
  private logTail: string[] = [];
  private child: ChildProcess | null = null;
  private startedAt = 0;
  private failures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private token: string | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: TunnelManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  status(): TunnelStatus {
    return {
      mode: this.mode,
      state: this.state,
      url: this.url,
      hostname: this.mode === 'named' ? this.deps.settings.get<string | null>(TUNNEL_HOSTNAME_KEY, null) : null,
      lastError: this.lastError,
      logTail: [...this.logTail],
    };
  }

  async start(body: TunnelStartBody, _actorId: number): Promise<TunnelStatus> {
    const { settings } = this.deps;
    let token: string | null = null;
    if (body.mode === 'named') {
      if (body.token) settings.setSecret(TUNNEL_TOKEN_KEY, body.token);
      if (body.hostname !== undefined) settings.set(TUNNEL_HOSTNAME_KEY, body.hostname.trim() || null);
      token = settings.getSecret(TUNNEL_TOKEN_KEY);
      if (!token) throw errors.validation('A tunnel token is required for a named tunnel');
    }
    await this.killChild();
    settings.set(TUNNEL_MODE_KEY, body.mode);
    this.mode = body.mode;
    this.token = token;
    this.failures = 0;
    this.lastError = null;
    this.logTail = [];
    this.launch();
    return this.status();
  }

  async stop(_actorId: number): Promise<TunnelStatus> {
    await this.killChild();
    this.deps.settings.set(TUNNEL_MODE_KEY, 'off');
    this.mode = 'off';
    this.token = null;
    this.url = null;
    this.lastError = null;
    this.failures = 0;
    this.setState('stopped');
    return this.status();
  }

  async restore(): Promise<void> {
    const mode = this.deps.settings.get<TunnelMode>(TUNNEL_MODE_KEY, 'off');
    if (mode !== 'quick' && mode !== 'named') return;
    try {
      await this.start({ mode }, 0);
    } catch (err) {
      this.deps.log.warn({ err, mode }, 'tunnel restore failed');
      this.mode = mode;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.setState('error');
    }
  }

  /** Stops the child on server shutdown; keeps the persisted mode so restore() resumes it. */
  async shutdown(): Promise<void> {
    await this.killChild();
  }

  // ---- internals ----

  private launch(): void {
    const mode = this.mode as ActiveMode;
    this.url = null;
    const bin = this.deps.binPath();
    if (!bin) {
      this.lastError = 'cloudflared not found';
      this.setState('error');
      return;
    }
    const args =
      mode === 'quick'
        ? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.deps.port()}`]
        : ['tunnel', '--no-autoupdate', 'run', '--token', this.token ?? ''];

    let child: ChildProcess;
    try {
      child = this.deps.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      this.child = null;
      this.startedAt = this.now();
      this.onChildGone(err instanceof Error ? err.message : String(err));
      return;
    }
    this.child = child;
    this.startedAt = this.now();
    this.setState('starting');
    this.deps.log.info({ mode, bin }, 'cloudflared started');

    let gone = false;
    const handleGone = (reason: string) => {
      if (gone) return;
      gone = true;
      if (this.child !== child) return; // intentional stop / replaced
      this.child = null;
      this.onChildGone(reason);
    };
    this.readLines(child.stdout, (l) => this.onLine(child, l));
    this.readLines(child.stderr, (l) => this.onLine(child, l));
    child.on('error', (err: Error) => handleGone(err.message));
    child.on('exit', (code: number | null, signal: string | null) =>
      handleGone(`cloudflared exited (${signal ? `signal ${signal}` : `code ${code}`})`),
    );
  }

  private onLine(child: ChildProcess, line: string): void {
    if (this.child !== child) return;
    this.logTail.push(line);
    if (this.logTail.length > LOG_TAIL) this.logTail.splice(0, this.logTail.length - LOG_TAIL);
    if (this.state === 'running') return;
    if (this.mode === 'quick') {
      const url = parseQuickTunnelUrl(line);
      if (url) {
        this.url = url;
        this.setState('running');
      }
    } else if (this.mode === 'named' && isNamedTunnelRegistered(line)) {
      const host = this.deps.settings.get<string | null>(TUNNEL_HOSTNAME_KEY, null);
      this.url = host ? `https://${host}` : null;
      this.setState('running');
    }
  }

  private onChildGone(reason: string): void {
    this.url = null;
    this.lastError = reason;
    const fast = this.now() - this.startedAt < FAST_EXIT_MS;
    this.failures = fast ? this.failures + 1 : 1;
    this.deps.log.warn({ reason, failures: this.failures }, 'cloudflared exited unexpectedly');
    if (this.failures >= MAX_FAST_FAILURES) {
      this.setState('error');
      return;
    }
    const delay = Math.min(1000 * 2 ** (this.failures - 1), MAX_BACKOFF_MS);
    this.setState('starting');
    const timerFn = this.deps.setTimeout ?? globalThis.setTimeout;
    const timer = timerFn(() => {
      if (this.restartTimer !== timer) return;
      this.restartTimer = null;
      if (this.mode !== 'off' && !this.child) this.launch();
    }, delay);
    (timer as { unref?: () => void }).unref?.();
    this.restartTimer = timer;
  }

  private async killChild(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode != null) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once('exit', finish);
      child.once('error', finish);
      const t = globalThis.setTimeout(finish, KILL_WAIT_MS);
      (t as { unref?: () => void }).unref?.();
      try {
        if (!child.kill()) finish();
      } catch {
        finish();
      }
    });
  }

  private setState(state: TunnelStatus['state']): void {
    this.state = state;
    this.deps.bus.emit('tunnel:status', this.status());
  }

  private readLines(stream: Readable | null, onLine: (line: string) => void): void {
    if (!stream) return;
    let buf = '';
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk: string | Buffer) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.search(/\r?\n/)) !== -1) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(buf[idx] === '\r' ? idx + 2 : idx + 1);
        if (line) onLine(line);
      }
    });
    stream.on('error', () => undefined);
  }
}

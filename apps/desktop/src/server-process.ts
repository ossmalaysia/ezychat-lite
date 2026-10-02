// Supervises the standalone server: utilityProcess.fork when packaged (Electron ABI native
// modules), or the system `node` in development (repo node_modules are built for Node's ABI).
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { utilityProcess, type UtilityProcess } from 'electron';
import { probeServer } from './detect.js';

export type ServerState = 'starting' | 'running' | 'crashed' | 'stopped';

export interface StandaloneServerOptions {
  entry: string;
  dataDir: string;
  port: number;
  webDist: string;
  cloudflaredDir: string;
  /** full path of the cloudflared binary (exported as WATI_CLOUDFLARED when it exists) */
  cloudflaredBinary?: string | null;
  version?: string;
  log: (s: string) => void;
  /** 'utility' = Electron utilityProcess (default), 'node' = spawn system node (dev) */
  runtime?: 'utility' | 'node';
}

type Child = { kind: 'utility'; p: UtilityProcess } | { kind: 'node'; p: ChildProcess };

const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 30_000;
const LOG_LINES = 200;

export function serverEnv(o: Pick<StandaloneServerOptions, 'cloudflaredDir' | 'cloudflaredBinary' | 'version'>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, WATI_CLOUDFLARED_DIR: o.cloudflaredDir };
  delete env.ELECTRON_RUN_AS_NODE;
  if (o.cloudflaredBinary && existsSync(o.cloudflaredBinary)) env.WATI_CLOUDFLARED = o.cloudflaredBinary;
  if (o.version) env.WATI_VERSION = o.version;
  return env;
}

export class StandaloneServer extends EventEmitter {
  private child: Child | null = null;
  private stopping = false;
  private backoff = MIN_BACKOFF;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private _state: ServerState = 'stopped';
  readonly logs: string[] = [];

  constructor(private readonly opts: StandaloneServerOptions) {
    super();
  }

  get state(): ServerState {
    return this._state;
  }

  override on(event: 'state', listener: (s: ServerState) => void): this;
  override on(event: string | symbol, listener: (...args: never[]) => void): this;
  override on(event: string | symbol, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  private setState(s: ServerState): void {
    if (this._state === s) return;
    this._state = s;
    this.emit('state', s);
  }

  private pushLog(chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.logs.push(line);
      if (this.logs.length > LOG_LINES) this.logs.shift();
      this.opts.log(line);
    }
  }

  start(): void {
    if (this.child) return;
    this.stopping = false;
    this.spawnChild();
  }

  private spawnChild(): void {
    const o = this.opts;
    const args = ['--data', o.dataDir, '--port', String(o.port), '--mode', 'standalone', '--web-dist', o.webDist];
    const env = serverEnv(o);
    this.setState('starting');
    this.startedAt = Date.now();
    this.pushLog(`[desktop] starting server (${o.runtime ?? 'utility'}): ${o.entry}`);
    if (o.runtime === 'node') {
      const p = spawn('node', [o.entry, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      p.stdout?.on('data', (d: Buffer) => this.pushLog(d.toString('utf8')));
      p.stderr?.on('data', (d: Buffer) => this.pushLog(d.toString('utf8')));
      p.on('error', (err) => {
        this.pushLog(`[desktop] failed to spawn node: ${err.message}`);
      });
      p.on('exit', (code) => this.onExit(code ?? 1));
      this.child = { kind: 'node', p };
    } else {
      const p = utilityProcess.fork(o.entry, args, {
        env: env as Record<string, string>,
        stdio: 'pipe',
        serviceName: 'WA Team Inbox Server',
      });
      p.stdout?.on('data', (d: Buffer) => this.pushLog(d.toString('utf8')));
      p.stderr?.on('data', (d: Buffer) => this.pushLog(d.toString('utf8')));
      p.on('exit', (code) => this.onExit(code));
      this.child = { kind: 'utility', p };
    }
    this.pollHealth();
  }

  private pollHealth(): void {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    const tick = async () => {
      if (!this.child || this.stopping) return;
      const r = await probeServer(this.opts.port);
      if (!this.child || this.stopping) return;
      if (r) {
        this.setState('running');
        return;
      }
      this.healthTimer = setTimeout(() => void tick(), 400);
    };
    this.healthTimer = setTimeout(() => void tick(), 300);
  }

  private onExit(code: number): void {
    this.child = null;
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.pushLog(`[desktop] server exited with code ${code}`);
    if (this.stopping) {
      this.setState('stopped');
      this.emit('exit', code);
      return;
    }
    this.setState('crashed');
    this.emit('exit', code);
    if (code === 2) {
      this.pushLog('[desktop] invalid server arguments; not restarting');
      return;
    }
    // a run that lasted > 60s resets the backoff
    if (Date.now() - this.startedAt > 60_000) this.backoff = MIN_BACKOFF;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
    this.pushLog(`[desktop] restarting in ${Math.round(delay / 1000)}s`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.spawnChild();
    }, delay);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.healthTimer) clearTimeout(this.healthTimer);
    const c = this.child;
    if (!c) {
      this.setState('stopped');
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(force);
        resolve();
      };
      this.once('exit', done);
      const force = setTimeout(() => {
        // hard kill if graceful shutdown hangs
        if (c.kind === 'node') c.p.kill('SIGKILL');
        else c.p.kill();
        setTimeout(resolve, 500);
      }, 8000);
      if (c.kind === 'node') c.p.kill('SIGTERM');
      else c.p.kill();
    });
    this.child = null;
    this.setState('stopped');
  }
}

/** Runs the server entry once with extra args (e.g. --reset-admin) and returns its output. */
export function runServerCommand(o: {
  entry: string;
  args: string[];
  runtime: 'utility' | 'node';
  env?: NodeJS.ProcessEnv;
}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const exe = o.runtime === 'node' ? 'node' : process.execPath;
    const env: NodeJS.ProcessEnv = { ...process.env, ...o.env };
    if (o.runtime === 'utility') env.ELECTRON_RUN_AS_NODE = '1';
    const p = spawn(exe, [o.entry, ...o.args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    p.stdout?.on('data', (d: Buffer) => (output += d.toString('utf8')));
    p.stderr?.on('data', (d: Buffer) => (output += d.toString('utf8')));
    p.on('error', (err) => resolve({ code: 1, output: output + err.message }));
    p.on('exit', (code) => resolve({ code: code ?? 1, output: output.trim() }));
  });
}

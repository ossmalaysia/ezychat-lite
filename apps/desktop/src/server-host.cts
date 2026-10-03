// Thin launcher the desktop uses to run the bundled server (standalone and OS service).
// argv: <server entry> <server args...>. It
//  1. applies the persisted `port` setting (Admin > Settings) from <data>/app.db over --port,
//     so a port change takes effect on the next start even though the desktop passes --port;
//  2. writes the effective port to $WATI_PORT_FILE so the desktop can find the server;
//  3. turns a 'shutdown' IPC message (Electron utilityProcess parentPort or Node child IPC) into
//     the server's SIGTERM handler, because on Windows kill() terminates without running it.
// CommonJS (.cts → .cjs) so it can be loaded by utilityProcess.fork / ELECTRON_RUN_AS_NODE.
/* eslint-disable @typescript-eslint/no-require-imports */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const SHUTDOWN_MESSAGE = 'wati:shutdown';

export function isValidPort(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535;
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

/**
 * Applies the persisted port setting over --port. Returns the server args to use and the
 * effective port (null when the args carry no port and no setting exists).
 */
export function prepareServerArgs(
  args: readonly string[],
  readPortSetting: (dataDir: string) => number | null,
): { args: string[]; port: number | null } {
  const out = [...args];
  if (out.includes('--reset-admin')) return { args: out, port: null };
  const data = flagValue(out, 'data');
  let setting: number | null = null;
  if (data) {
    try {
      const v = readPortSetting(data);
      setting = isValidPort(v) ? v : null;
    } catch {
      setting = null;
    }
  }
  const i = out.indexOf('--port');
  if (setting !== null) {
    if (i >= 0 && out[i + 1] !== undefined) out[i + 1] = String(setting);
    else out.push('--port', String(setting));
    return { args: out, port: setting };
  }
  const explicit = i >= 0 ? Number(out[i + 1]) : NaN;
  return { args: out, port: isValidPort(explicit) ? explicit : null };
}

/** Reads settings.port (JSON value) from <dataDir>/app.db read-only; null when absent. */
export function readPortSettingFromDb(dataDir: string): number | null {
  const file = join(dataDir, 'app.db');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Database = require('better-sqlite3') as any;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'port'").get() as
      { value?: string } | undefined;
    if (!row || typeof row.value !== 'string') return null;
    const v: unknown = JSON.parse(row.value);
    return isValidPort(v) ? v : null;
  } finally {
    db.close();
  }
}

export function isShutdownMessage(m: unknown): boolean {
  if (m === SHUTDOWN_MESSAGE) return true;
  // Electron parentPort delivers a MessageEvent-like { data }
  return typeof m === 'object' && m !== null && (m as { data?: unknown }).data === SHUTDOWN_MESSAGE;
}

/** Service configuration may retain the version from installation; report the actual runtime. */
export function applyRuntimeVersion(entry: string, env: NodeJS.ProcessEnv): void {
  try {
    const file = join(dirname(resolve(entry)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) env.WATI_VERSION = pkg.version;
  } catch {
    // Unbundled launchers without runtime metadata retain the explicit environment version.
  }
}

function main(): void {
  const [entry, ...rest] = process.argv.slice(2);
  if (!entry) {
    process.stderr.write('server-host: missing server entry\n');
    process.exit(2);
  }
  const { args, port } = prepareServerArgs(rest, (d) => readPortSettingFromDb(d));
  const portFile = process.env.WATI_PORT_FILE;
  if (portFile && port !== null) {
    try {
      mkdirSync(dirname(portFile), { recursive: true });
      writeFileSync(portFile, JSON.stringify({ port, pid: process.pid }));
    } catch (err) {
      process.stderr.write(`server-host: could not write port file: ${(err as Error).message}\n`);
    }
  }
  const onMessage = (m: unknown) => {
    if (isShutdownMessage(m))
      (process.emit as (ev: string, ...a: unknown[]) => boolean)('SIGTERM', 'SIGTERM');
  };
  const parentPort = (
    process as unknown as { parentPort?: { on(ev: 'message', fn: (m: unknown) => void): void } }
  ).parentPort;
  parentPort?.on('message', onMessage);
  if (typeof process.send === 'function') {
    process.on('message', onMessage);
    // don't let the IPC channel keep the process alive on its own
    process.channel?.unref();
  }
  const entryPath = resolve(entry);
  applyRuntimeVersion(entryPath, process.env);
  process.argv = [process.argv[0] ?? process.execPath, entryPath, ...args];
  require(entryPath);
}

// require.main is the host under ELECTRON_RUN_AS_NODE/node; argv[1] covers utilityProcess.fork.
if (require.main === module || /server-host\.cjs$/.test(process.argv[1] ?? '')) main();

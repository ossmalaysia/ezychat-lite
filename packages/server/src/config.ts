import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 7420;

export interface ServerConfig {
  dataDir: string;
  port: number;
  host: string;
  mode: 'standalone' | 'service' | 'dev';
  fakeWa: boolean;
  webDistDir: string | null;
  version: string;
  /** true when --port / WATI_PORT was given; otherwise startServer uses the persisted `port` setting */
  portExplicit?: boolean;
  /** true when --host / WATI_HOST was given; otherwise startServer derives it from the `lan_enabled` setting */
  hostExplicit?: boolean;
}

const MODES = ['standalone', 'service', 'dev'] as const;

function readVersion(): string {
  if (process.env.WATI_VERSION) return process.env.WATI_VERSION;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/config.ts and dist/config.js both sit one level below the package root
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function defaultWebDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '..', '..', '..', 'apps', 'web', 'dist');
  return existsSync(join(candidate, 'index.html')) ? candidate : null;
}

/**
 * Flags: --data <dir> (required unless WATI_DATA env), --port <n>, --host <h>, --mode <m>,
 * --fake-wa, --web-dist <dir>, --reset-admin. Also accepts --flag=value.
 * Env fallbacks: WATI_DATA, WATI_PORT, WATI_HOST, WATI_MODE, WATI_FAKE_WA=1, WATI_WEB_DIST.
 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ServerConfig & { resetAdmin: boolean } {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const eq = a.indexOf('=');
    if (eq !== -1) {
      flags.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const name = a.slice(2);
    if (name === 'fake-wa' || name === 'reset-admin') {
      flags.set(name, true);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`missing value for --${name}`);
    flags.set(name, next);
    i++;
  }
  const known = new Set(['data', 'port', 'host', 'mode', 'fake-wa', 'web-dist', 'reset-admin']);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag: --${k}`);

  const str = (k: string): string | undefined => {
    const v = flags.get(k);
    return typeof v === 'string' ? v : undefined;
  };

  const data = str('data') ?? env.WATI_DATA;
  if (!data) throw new Error('--data <dir> is required (or set WATI_DATA)');

  const portRaw = str('port') ?? env.WATI_PORT;
  let port = DEFAULT_PORT;
  if (portRaw !== undefined) {
    port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${portRaw}`);
  }

  const modeRaw = str('mode') ?? env.WATI_MODE ?? 'standalone';
  if (!(MODES as readonly string[]).includes(modeRaw)) throw new Error(`invalid mode: ${modeRaw}`);

  const hostRaw = str('host') ?? env.WATI_HOST;
  const webDist = str('web-dist') ?? env.WATI_WEB_DIST;

  return {
    dataDir: resolve(data),
    port,
    host: hostRaw ?? '127.0.0.1',
    mode: modeRaw as ServerConfig['mode'],
    fakeWa: flags.get('fake-wa') === true || env.WATI_FAKE_WA === '1',
    webDistDir: webDist ? resolve(webDist) : defaultWebDist(),
    version: readVersion(),
    portExplicit: portRaw !== undefined,
    hostExplicit: hostRaw !== undefined,
    resetAdmin: flags.get('reset-admin') === true,
  };
}

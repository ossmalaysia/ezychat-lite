import { join } from 'node:path';
import { parseArgs } from './config.js';
import { openDb } from './db/index.js';
import type { ServerExtension } from './extensions.js';
import { LockedError } from './lock.js';
import { startServer } from './main.js';
import { resetFirstAdmin } from './auth/reset.js';

/** What another product build (e.g. EzyChat Enterprise) passes to reuse the server CLI. */
export interface CliProduct {
  /** Edition reported by /api/health; default 'lite'. */
  edition?: string;
  /** Server extensions; Lite passes none. */
  extensions?: readonly ServerExtension[];
  /** Process exit (tests replace it); default process.exit. */
  exit?: (code: number) => never;
}

/**
 * The server command line: parses argv/env, handles --reset-admin, starts the server.
 * Exit codes: 2 bad arguments, 3 data dir locked by another server, 1 any other failure.
 */
export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  product?: CliProduct,
): Promise<void> {
  const exit: (code: number) => never = product?.exit ?? ((code) => process.exit(code));
  let cfg: ReturnType<typeof parseArgs>;
  try {
    cfg = parseArgs(argv, env);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.stderr.write(
      'Usage: server --data <dir> [--port <n>] [--host <h>] [--mode standalone|service|dev] [--fake-wa] [--web-dist <dir>] [--reset-admin]\n',
    );
    exit(2);
  }

  if (cfg.resetAdmin) {
    try {
      const db = openDb(join(cfg.dataDir, 'app.db'));
      const { username, password } = await resetFirstAdmin(db);
      db.close();
      process.stdout.write(`New admin password for ${username}: ${password}\n`);
    } catch (err) {
      process.stderr.write(`Reset failed: ${(err as Error).message}\n`);
      exit(1);
    }
    exit(0);
  }

  const { resetAdmin: _ignored, ...serverCfg } = cfg;
  try {
    await startServer(serverCfg, { extensions: product?.extensions, edition: product?.edition });
  } catch (err) {
    if (err instanceof LockedError) {
      process.stderr.write(`${err.message}\n`);
      exit(3);
    }
    process.stderr.write(`Failed to start server: ${(err as Error).stack ?? String(err)}\n`);
    exit(1);
  }
}

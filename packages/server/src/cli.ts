#!/usr/bin/env node
import { join } from 'node:path';
import { parseArgs } from './config.js';
import { openDb } from './db/index.js';
import { LockedError } from './lock.js';
import { startServer } from './main.js';
import { resetFirstAdmin } from './auth/reset.js';

async function run(): Promise<void> {
  let cfg: ReturnType<typeof parseArgs>;
  try {
    cfg = parseArgs(process.argv.slice(2), process.env);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.stderr.write(
      'Usage: server --data <dir> [--port <n>] [--host <h>] [--mode standalone|service|dev] [--fake-wa] [--web-dist <dir>] [--reset-admin]\n',
    );
    process.exit(2);
  }

  if (cfg.resetAdmin) {
    try {
      const db = openDb(join(cfg.dataDir, 'app.db'));
      const { username, password } = await resetFirstAdmin(db);
      db.close();
      process.stdout.write(`New admin password for ${username}: ${password}\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Reset failed: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  const { resetAdmin: _ignored, ...serverCfg } = cfg;
  try {
    await startServer(serverCfg);
  } catch (err) {
    if (err instanceof LockedError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(3);
    }
    process.stderr.write(`Failed to start server: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  }
}

void run();

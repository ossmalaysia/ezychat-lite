// Second e2e server for e2e/multi-inbox.spec.ts: the same built web app, fake WhatsApp, a fresh
// data dir and room for several inboxes (`--max-inboxes`, dev mode with fake WhatsApp only).
// It waits for the main e2e server first: that one builds apps/web/dist, and two parallel builds
// would write the same folder.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const MAIN_HEALTH = 'http://127.0.0.1:7499/api/health';
const dataDir = resolve(process.cwd(), '.e2e-data-multi');

async function waitForMain() {
  for (let i = 0; i < 480; i++) {
    try {
      const res = await fetch(MAIN_HEALTH);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the main e2e server did not start');
}

rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
await waitForMain();
const child = spawn(
  'npx',
  [
    'tsx',
    'packages/server/src/cli.ts',
    '--data',
    dataDir,
    '--port',
    '7498',
    '--fake-wa',
    '--mode',
    'dev',
    '--max-inboxes',
    '3',
    '--web-dist',
    'apps/web/dist',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));

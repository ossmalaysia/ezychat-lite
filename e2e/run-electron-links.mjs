// Runs e2e/electron-links.smoke.mjs end to end: a fresh --fake-wa server on a temp data dir (port 7499),
// the link test in the real desktop window, then stops the server. Needs `npm run build -w @ezychat/web`
// and `npm run build -w @ezychat/desktop` first. Used by CI (windows-latest) and `npm run e2e:electron-links`.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 7499;
const BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), 'ezychat-links-'));
const server = spawn(
  process.execPath,
  [
    '--conditions=ezychat-source',
    '--import',
    'tsx',
    'packages/server/src/cli.ts',
    '--data',
    data,
    '--port',
    String(PORT),
    '--fake-wa',
    '--web-dist',
    'apps/web/dist',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

let code;
try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('server did not start within 60 s');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const test = spawn(process.execPath, ['e2e/electron-links.smoke.mjs', BASE], {
    stdio: 'inherit',
  });
  code = await new Promise((resolve) => test.on('exit', (c) => resolve(c ?? 1)));
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
}
process.exit(code);

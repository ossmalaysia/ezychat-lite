#!/usr/bin/env node
/** Verify native modules and first-run auth inside a packaged app, using only temporary fake-WA data. */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = resolve(root, process.argv[2] ?? 'apps/desktop/release');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const windows = process.platform === 'win32';
if (!windows && process.platform !== 'darwin') throw new Error('Smoke supports Windows and macOS');
const app = windows
  ? join(release, 'win-unpacked')
  : join(release, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'WA Team Inbox.app', 'Contents');
const resources = join(app, windows ? 'resources' : 'Resources');
const exe = windows ? join(app, 'WA Team Inbox.exe') : join(app, 'MacOS', 'WA Team Inbox');
const entry = join(resources, 'app.asar.unpacked', 'dist', 'server', 'server.cjs');
const data = await mkdtemp(join(tmpdir(), 'wati-package-smoke-'));
const listener = createServer();
await new Promise((ok, fail) => listener.once('error', fail).listen(0, '127.0.0.1', ok));
const port = listener.address().port;
await new Promise((ok, fail) => listener.close((error) => (error ? fail(error) : ok())));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  exe,
  [
    entry,
    '--data',
    data,
    '--port',
    String(port),
    '--fake-wa',
    '--web-dist',
    join(resources, 'web'),
  ],
  {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      WATI_CLOUDFLARED_DIR: join(resources, 'cloudflared'),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let tail = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => {
    tail = (tail + chunk).slice(-12000);
  });
let spawnError;
let exited = false;
const closed = new Promise((ok) => {
  child.once('error', (error) => {
    spawnError = error;
    exited = true;
    ok();
  });
  child.once('close', () => {
    exited = true;
    ok();
  });
});

function check(condition, message) {
  if (!condition) throw new Error(message);
}
async function post(path, body, cookie) {
  return fetch(origin + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

try {
  let health;
  for (let probe = 0; probe < 120; probe++) {
    if (exited) throw spawnError ?? new Error(`Packaged server exited before readiness.\n${tail}`);
    try {
      const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      /* wait for startup */
    }
    await delay(250);
  }
  check(health?.version === pkg.version, 'Packaged server version/readiness mismatch');
  const setup = await (await fetch(origin + '/api/setup/status')).json();
  check(setup.needsSetup, 'Isolated data must require first-time setup');
  check((await fetch(origin + '/login')).ok, 'Packaged web files missing');
  const credentials = { username: 'smoke-admin', password: 'smoke-only-password-123' };
  const created = await post('/api/setup/admin', { ...credentials, displayName: 'Smoke test' });
  check(created.ok, `First-admin setup failed: ${created.status}`);
  const cookie = created.headers.get('set-cookie')?.split(';')[0];
  check(cookie, 'First-admin session missing');
  check((await post('/api/auth/logout', {}, cookie)).ok, 'Account logout failed');
  check(
    (await fetch(origin + '/api/me', { headers: { Cookie: cookie } })).status === 401,
    'Logged-out session still works',
  );
  check((await post('/api/auth/login', credentials)).ok, 'Password verification/login failed');
  console.log(
    JSON.stringify({
      version: health.version,
      platform: process.platform,
      arch: process.arch,
      nativeAuthAndDatabase: true,
      isolatedSetupAndLogout: true,
    }),
  );
} finally {
  if (!exited) child.kill('SIGTERM');
  await Promise.race([closed, delay(10000)]);
  if (!exited) {
    child.kill('SIGKILL');
    await closed;
  }
  if (resolve(data).startsWith(resolve(tmpdir(), 'wati-package-smoke-')))
    await rm(data, { recursive: true, force: true });
}

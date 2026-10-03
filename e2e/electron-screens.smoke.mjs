// Same as screens.smoke.mjs but inside a real Electron window (the desktop app's browser engine), to catch
// Electron-only render crashes. Usage: node e2e/electron-screens.smoke.mjs <baseUrl> <outDir>
// Server: --fake-wa on a temp data dir; an admin "smoke"/"smoke-pass-123" is created if setup is needed.
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:7499';
const OUT = process.argv[3] ?? 'test-results/electron-screens';
mkdirSync(OUT, { recursive: true });
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const electronPath = require('electron');

const ROUTES = ['/', '/admin/members', '/admin/quick-replies', '/admin/whatsapp', '/admin/tunnel', '/admin/settings', '/admin/audit'];
const app = await electron.launch({ executablePath: electronPath, args: [new URL('./electron-shell.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], env: { ...process.env, SMOKE_URL: `${BASE}/login` } });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push({ at: page.url(), msg: `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 5).join('\n')}` }));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push({ at: page.url(), msg: `console: ${m.text().slice(0, 300)}` }));
await page.waitForLoadState('domcontentloaded');

// log in from inside the page so the session cookie lands in the Electron profile
const status = await page.evaluate(async () => {
  const h = { 'content-type': 'application/json' };
  const s = await (await fetch('/api/setup/status')).json();
  if (s.needsSetup) await fetch('/api/setup/admin', { method: 'POST', headers: h, body: JSON.stringify({ username: 'smoke', displayName: 'Smoke Admin', password: 'smoke-pass-123' }) });
  const r = await fetch('/api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ username: 'smoke', password: 'smoke-pass-123' }) });
  return r.status;
});
console.log('login', status);

for (const path of ROUTES) {
  const before = errors.length;
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  const text = (await page.locator('body').innerText().catch(() => '')).trim();
  const name = path === '/' ? 'inbox' : path.replace('/admin/', 'admin-');
  await page.screenshot({ path: join(OUT, `${name}-electron.png`) });
  const newErrors = errors.slice(before);
  const blank = text.length < 20;
  console.log(`${blank || newErrors.length ? 'FAIL' : 'PASS'}  ${path}${blank ? '  (BLANK)' : ''}`);
  for (const e of newErrors) console.log('      ' + e.msg.replace(/\n/g, '\n      '));
}
await app.close();

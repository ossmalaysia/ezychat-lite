// Reproduces the Tunnel page flow: open /admin/tunnel, choose Quick, start, and watch for crashes.
// Usage: node e2e/tunnel.smoke.mjs <baseUrl> <outDir> <username> <password>
import { chromium } from '@playwright/test';
import { join } from 'node:path';

const [BASE = 'http://127.0.0.1:7499', OUT = 'test-results/screens', USER = 'smoke', PASS = 'smoke-pass-123'] = process.argv.slice(2);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(`console: ${m.text().slice(0, 300)}`));
page.on('response', async (r) => {
  if (r.url().includes('/api/tunnel')) console.log('api', r.request().method(), r.url().replace(BASE, ''), r.status(), (await r.text().catch(() => '')).slice(0, 200));
});

const login = await page.request.post('/api/auth/login', { data: { username: USER, password: PASS }, headers: { origin: BASE } });
if (!login.ok()) throw new Error(`login ${login.status()}`);
await page.goto('/admin/tunnel');
await page.waitForLoadState('networkidle');
await page.getByText('Quick', { exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'tunnel-1-quick-selected.png') });
const start = page.getByRole('button', { name: /start|turn on|apply/i }).first();
console.log('start button:', await start.textContent().catch(() => '(none)'));
await start.click().catch((e) => errors.push(`click failed: ${e.message}`));
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2500);
  const text = (await page.locator('body').innerText().catch(() => '')).trim();
  if (text.length < 20) { errors.push(`BLANK SCREEN after ${(i + 1) * 2.5}s`); break; }
  if (/trycloudflare\.com/.test(text)) { console.log('URL shown'); break; }
}
await page.screenshot({ path: join(OUT, 'tunnel-2-after-start.png') });
// stop the tunnel again so nothing stays exposed
await page.request.post('/api/tunnel/stop', { headers: { origin: BASE } });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();

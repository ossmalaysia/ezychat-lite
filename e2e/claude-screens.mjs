// Screen review shots for the Claude API connection against e2e/agents-devbuild.ts (mock model, temp data).
// Usage: node e2e/claude-screens.mjs <baseURL> <outDir>
// Only selects the Claude option and types a placeholder key: never tests or saves it, so nothing reaches Anthropic.
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };
const browser = existsSync(chromium.executablePath())
  ? await chromium.launch()
  : await chromium.launch({ channel: 'chrome' });
const setup = await browser.newContext({ baseURL: base });
if ((await (await setup.request.get('/api/setup/status')).json()).needsSetup)
  await setup.request.post('/api/setup/admin', { data: ADMIN, headers: { Origin: base } });
await setup.close();

const VIEWS = [
  ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'mobile',
    { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
];
for (const scheme of ['light', 'dark']) {
  for (const [view, opts] of VIEWS) {
    const tag = `${view}-${scheme}`;
    const c = await browser.newContext({
      baseURL: base,
      locale: 'en-US',
      serviceWorkers: 'block',
      colorScheme: scheme,
      ...opts,
    });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto('/login');
    await p.getByLabel('Username').fill(ADMIN.username);
    await p.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForLoadState('networkidle');
    await p.goto('/admin/settings/ai');
    await p.getByText('Connection mode', { exact: true }).waitFor();
    await p.getByText('Claude API key', { exact: true }).first().click();
    await p
      .getByLabel('Anthropic API key', { exact: true })
      .fill('sk-ant-placeholder-not-a-real-key');
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(out, `01-settings-ai-claude-${tag}.png`), fullPage: true });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sw > 0) console.log(`OVERFLOW ${tag}: +${sw}px`);
    if (errors.length) console.log(`PAGEERROR ${tag}: ${errors.join(' | ')}`);
    await c.close();
  }
}
await browser.close();
console.log('done');

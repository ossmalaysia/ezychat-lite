// Production UI state captures against enrichment-devbuild.ts --fake-wa --mock-ai.
// Usage: node e2e/enrichment-screens.mjs <port>
/* global window, document */
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? 7490);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const base = `http://127.0.0.1:${port}`;
const out = fileURLToPath(new URL('../docs/screenshots/customer-enrichment/', import.meta.url));
const health = await fetch(base + '/api/health');
if (health.headers.get('x-enrichment-devbuild') !== 'mock-ai')
  throw new Error('Use the isolated mock-AI Dev Build runner');
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ username: 'aisyah', password: 'demo-pass-123' }),
});
if (!login.ok) throw new Error('Seed the demo Dev Build first');
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const baselineAudit = await (
  await fetch(base + '/api/audit?limit=50', { headers: { cookie } })
).json();
mkdirSync(out, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const sizes = { desktop: { width: 1280, height: 900 }, mobile: { width: 360, height: 800 } };
let captures = 0;
for (const theme of ['light', 'dark']) {
  for (const [viewport, size] of Object.entries(sizes)) {
    const context = await browser.newContext({
      viewport: size,
      baseURL: base,
      colorScheme: theme,
      locale: 'en-US',
      serviceWorkers: 'block',
    });
    await context.addCookies(
      cookie.split('; ').map((c) => {
        const [name, ...value] = c.split('=');
        return { name, value: value.join('='), url: base };
      }),
    );
    await context.addInitScript((value) => {
      window.localStorage.setItem('wati.theme', value);
      window.localStorage.setItem('wati.locale', 'en');
    }, theme);
    const page = await context.newPage();
    // Reuse the actual initial audit response so Settings test actions do not bury the demo rows.
    await page.route('**/api/audit?*', async (route) => route.fulfill({ json: baselineAudit }));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const card = () =>
      page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByText('Customer enrichment', { exact: true }) });
    async function shot(name, anchor) {
      if (anchor) await anchor.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, name).toBeLessThanOrEqual(1);
      expect(errors, name).toEqual([]);
      await page.screenshot({
        path: join(out, `${name}-${viewport}-${theme}.png`),
        fullPage: false,
      });
      captures++;
    }
    const change = async (enabled) => {
      const result = await page.request.put('/api/ai/enrichment', {
        data: { enabled },
        headers: { origin: base },
      });
      expect(result.status()).toBe(200);
    };
    await change(false);
    await page.goto('/admin/settings/ai');
    await card().getByRole('switch').waitFor();
    await shot('settings-off', card());
    await card().getByRole('switch').click();
    await shot('settings-editing', card());
    await card().getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(card().getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
    await shot('settings-enabled', card());
    await card().getByText('View scoring rules', { exact: true }).click();
    await shot('settings-rules', card());
    await page.route('**/api/ai/enrichment', async (route) =>
      route.fulfill({ json: { enabled: true, connected: false } }),
    );
    await page.reload();
    await page.getByText('Enrichment is paused until the AI connection is restored.').waitFor();
    await shot('settings-paused', card());
    await page.unroute('**/api/ai/enrichment');
    await page.route('**/api/ai/enrichment', async (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'conflict', message: 'Temporarily unavailable' } },
      }),
    );
    await page.reload();
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await retry.waitFor();
    await shot('settings-error', retry);
    await page.unroute('**/api/ai/enrichment');
    await page.goto('/admin/audit');
    const scores = page.getByRole('button', {
      name: 'Enrichment details: Avg 100/100',
      exact: true,
    });
    await scores.first().waitFor();
    await shot(
      'audit',
      viewport === 'desktop'
        ? page.getByRole('heading', { name: 'Audit log', exact: true })
        : page.locator('li').filter({ has: scores.first() }).first(),
    );
    await scores.first().click();
    let dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await shot('score-replacement');
    await dialog.getByRole('link', { name: 'View source conversation', exact: true }).click();
    await page.getByText('jay@example.com', { exact: true }).waitFor();
    await shot('source-customer');
    await page.goto('/admin/audit');
    await scores.nth(1).click();
    dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await shot('score-added');
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.route('**/api/audit?*', async (route) => {
      const data = structuredClone(baselineAudit);
      for (const entry of data.entries)
        if (entry.meta.enrichment) {
          entry.meta.enrichment.policy = 'demo-' + 'x'.repeat(59);
          entry.meta.enrichment.messageId = 'demo-source-' + 'long-reference-'.repeat(15);
          for (const field of entry.meta.enrichment.fields)
            field.messageId = entry.meta.enrichment.messageId;
        }
      await route.fulfill({ json: data });
    });
    await page.reload();
    await scores.first().click();
    await page.getByRole('dialog').waitFor();
    await shot('score-long');
    await page.unroute('**/api/audit?*');
    await context.close();
  }
}
await browser.close();
console.log(
  `${captures} captures passed at 1280/360px, light/dark: off, editing, enabled, rules, paused, error, Audit, replacement, source customer, added and long references`,
);

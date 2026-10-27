// Screenshots of the connector list and partner (MCP) connectors in the real app, against
// e2e/agents-devbuild.ts started with the partner MCP test server's env lines, after
// e2e/devbuild-partner-check.mjs has run there (its admin, agent and activity). Desktop 1280 px and
// mobile 360 px, light and dark; reports page errors and horizontal overflow. Never calls a model.
// Usage: node e2e/partner-screens.mjs <port> <outDir> [partner origin, default https://127.0.0.1:7610]
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, join } from 'node:path';

const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
const PARTNER = new URL(process.argv[4] ?? 'https://127.0.0.1:7610');
if (PARTNER.hostname !== '127.0.0.1') throw new Error('The partner test server runs on 127.0.0.1');
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'partner-screens');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
mkdirSync(OUT, { recursive: true });

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

/** Switches a test endpoint of the partner server (control token of the Dev Build check). */
async function partnerState(endpoint, state) {
  const res = await fetch(new URL('/_control', PARTNER), {
    method: 'POST',
    headers: { authorization: 'Bearer devbuild-partner', 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, state }),
  });
  if (!res.ok) throw new Error(`partner control answered ${res.status}`);
}

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};

let pass = 0;
for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    // Connect and test are limited to 10 a minute per admin; each pass makes about five.
    if (pass++ > 0) await new Promise((r) => setTimeout(r, 61_000));
    const ctx = await browser.newContext({
      ...size,
      baseURL: BASE,
      colorScheme: scheme,
      locale: 'en-US',
      timezoneId: 'Asia/Kuala_Lumpur',
      ignoreHTTPSErrors: true,
    });
    const req = (method, path, data) =>
      ctx.request.fetch(path, { method, data, headers: { origin: BASE } });
    await req('POST', '/api/auth/login', { username: 'checker', password: 'check-pass-123' });
    const disconnect = (id) => req('POST', `/api/connectors/mcp/${id}/disconnect`);
    for (const id of ['test-kedai', 'test-gudang', 'test-lejar', 'test-bayar', 'test-open'])
      await disconnect(id);

    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
      await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`), ...opts });
    };
    const partnerPage = async (id, tab = 'overview') => {
      await page.goto(`/admin/connectors/${id}?tab=${tab}`);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
    };

    await page.goto('/admin/connectors');
    await page.getByTestId('connectors-gallery').waitFor();
    await page.getByText(/Connector list updated/).waitFor();
    await shot('01-gallery-from-list', { fullPage: true });

    await partnerPage('test-kedai');
    await shot('02-kedai-not-connected', { fullPage: true });
    await page.getByRole('button', { name: 'Connect with an API key' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await shot('03-api-key-dialog');
    await dialog.getByLabel('API key').fill('pk_wrong_0000');
    await dialog.getByRole('button', { name: 'Test', exact: true }).click();
    await dialog.getByText(/refused this key/).waitFor();
    await shot('04-api-key-refused');
    await dialog.getByLabel('API key').fill('pk_test_kedai_4242');
    await dialog.getByRole('button', { name: 'Test', exact: true }).click();
    await dialog.getByText(/The connection works/).waitFor();
    await shot('05-api-key-works');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Key ending in 4242').waitFor();
    await shot('06-kedai-connected', { fullPage: true });

    await partnerPage('test-kedai', 'settings');
    await page.getByText('Rules the AI always follows').waitFor();
    await shot('07-kedai-settings', { fullPage: true });
    await partnerPage('test-kedai', 'activity');
    await shot('08-kedai-activity', { fullPage: true });

    await partnerState('api-key', 'down');
    await partnerPage('test-kedai');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await page.waitForTimeout(1500);
    await shot('09-kedai-unreachable', { fullPage: true });
    await partnerState('api-key', 'ok');

    await partnerPage('test-gudang');
    await page.getByRole('button', { name: 'Connect with your account details' }).click();
    await page.getByRole('dialog').waitFor();
    await shot('10-credentials-dialog');
    await page.keyboard.press('Escape');

    await partnerPage('test-bayar');
    await page.getByRole('button', { name: 'Connect with your own app' }).click();
    await page.getByRole('dialog').waitFor();
    await shot('11-own-app-dialog');
    await page.keyboard.press('Escape');

    await partnerPage('test-lejar');
    const [consent] = await Promise.all([
      ctx.waitForEvent('page'),
      page.getByRole('button', { name: /^Connect / }).click(),
    ]);
    try {
      await page.getByText('Waiting for you to sign in').waitFor({ timeout: 10_000 });
    } catch (error) {
      await page.screenshot({ path: join(OUT, `error-oauth-${suffix}.png`), fullPage: true });
      await consent.screenshot({ path: join(OUT, `error-oauth-tab-${suffix}.png`) });
      throw error;
    }
    await shot('12-oauth-waiting', { fullPage: true });
    await consent.waitForLoadState();
    await consent.getByRole('button', { name: 'Allow' }).click();
    await page.getByText('Connected', { exact: true }).first().waitFor({ timeout: 20_000 });
    await consent.close().catch(() => undefined);
    await shot('13-oauth-connected', { fullPage: true });

    await partnerPage('test-open');
    await shot('14-no-sign-in', { fullPage: true });

    await page.goto('/admin/connectors');
    await page.getByTestId('connectors-gallery').waitFor();
    await shot('15-gallery-your-connectors', { fullPage: true });
    await ctx.close();
  }

await browser.close();
console.log(problems.length ? problems.join('\n') : 'no page errors or horizontal overflow');
console.log(`screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);

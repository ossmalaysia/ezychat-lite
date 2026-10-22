// Screen review shots for AI agents against e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data).
// Usage: node e2e/agent-screens.mjs <baseURL> <outDir> <lite|enterprise>
//   (enterprise: start the runner with --max-inboxes 3)
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [base, out, mode = 'lite'] = process.argv.slice(2);
const enterprise = mode === 'enterprise';
mkdirSync(out, { recursive: true });
const H = { Origin: base };
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };
const agentBody = (displayName, extra = {}) => ({
  displayName,
  enabled: false,
  instructions: '',
  handoffRules: '',
  ...extra,
});

const browser = existsSync(chromium.executablePath())
  ? await chromium.launch()
  : await chromium.launch({ channel: 'chrome' });
const ctx = (opts = {}) =>
  browser.newContext({ baseURL: base, locale: 'en-US', serviceWorkers: 'block', ...opts });
async function api(req, method, path, data) {
  const r = await req.fetch(path, { method, data, headers: H });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.json().catch(() => null);
}

const setup = await ctx();
const req = setup.request;
if ((await (await req.get('/api/setup/status')).json()).needsSetup)
  await api(req, 'POST', '/api/setup/admin', ADMIN);
await api(req, 'POST', '/api/auth/login', { username: ADMIN.username, password: ADMIN.password });
let first;
if (enterprise) {
  await api(req, 'PATCH', '/api/inboxes/1', { name: 'Kopi Apong' });
  await api(req, 'POST', '/api/inboxes', { name: 'Catering', memberIds: [] });
  await api(req, 'POST', '/api/dev/fake-link', { inboxId: 2 });
  first = (
    await api(
      req,
      'POST',
      '/api/ai/agents',
      agentBody('Kopi Apong AI', { preset: 'sales', inboxId: 1 }),
    )
  ).agent;
  const faq = (
    await api(
      req,
      'POST',
      '/api/ai/agents',
      agentBody('Catering help desk', { preset: 'faq', inboxId: 2 }),
    )
  ).agent;
  await api(req, 'POST', `/api/ai/agents/${faq.id}/documents/text`, {
    name: 'Catering packages',
    text: 'Buffet for 40 from RM900. Booking 3 days ahead.',
  });
} else {
  await api(req, 'PUT', '/api/ai', agentBody('Kopi Apong AI'));
  first = (await api(req, 'GET', '/api/ai')).agents[0];
}
await api(req, 'POST', `/api/ai/agents/${first.id}/documents/text`, {
  name: 'Menu and opening hours',
  text: 'Kopi O RM2.50, kaya toast RM3.50. Open 7am to 3pm daily.',
});
await api(req, 'POST', `/api/ai/agents/${first.id}/documents/text`, {
  name: 'Lowest prices (internal)',
  text: 'Lowest price for a 40 pax order: RM850. Never give more than 10 % discount.',
  internal: true,
});
await setup.close();

const VIEWS = [
  ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'mobile',
    { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
];
const shot = async (p, name, fullPage = false) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(out, `${name}.png`), fullPage });
  const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sw > 0) console.log(`OVERFLOW ${name}: +${sw}px`);
};
for (const scheme of ['light', 'dark']) {
  for (const [view, opts] of VIEWS) {
    const tag = `${mode}-${view}-${scheme}`;
    const c = await ctx({ ...opts, colorScheme: scheme });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto('/login');
    await p.getByLabel('Username').fill(ADMIN.username);
    await p.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForLoadState('networkidle');

    await p.goto('/admin/members');
    await p.getByText('Kopi Apong AI').filter({ visible: true }).first().waitFor();
    await shot(p, `01-members-${tag}`);
    await p.goto(`/admin/members/ai/${first.id}`);
    await p.getByTestId('preset-badge').filter({ visible: true }).first().waitFor();
    await shot(p, `02-agent-page-${tag}`, true);
    await p.getByRole('button', { name: 'Add', exact: true }).first().click();
    await p.getByRole('menuitem', { name: 'Add text content', exact: true }).click();
    await p.getByRole('dialog').getByRole('switch', { name: 'Internal' }).click();
    await shot(p, `03-add-internal-item-${tag}`);
    await p.keyboard.press('Escape');
    await p.goto('/admin/members/ai/new?preset=faq');
    await p.waitForLoadState('networkidle');
    await shot(p, `04-new-agent-${tag}`, true);
    if (enterprise) {
      await p.goto('/admin/inboxes');
      await p.getByTestId('inbox-card').filter({ visible: true }).first().waitFor();
      await shot(p, `05-inboxes-${tag}`);
      await p.getByRole('button', { name: 'Edit · Catering' }).click();
      await p.getByRole('dialog').waitFor();
      await shot(p, `06-edit-inbox-${tag}`);
      await p.keyboard.press('Escape');
    }
    if (errors.length) console.log(`PAGEERROR ${tag}: ${errors.join(' | ')}`);
    await c.close();
  }
}
await browser.close();
console.log('done');

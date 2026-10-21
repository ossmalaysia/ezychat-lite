// Screen review shots for multi-inbox (production build, fake WhatsApp, temp data, --max-inboxes 3).
// Usage: start a server with --fake-wa --mode dev --max-inboxes 3 on a temp data dir, then
// node e2e/inbox-screens.mjs <baseURL> <outDir>
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const H = { Origin: base };
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };
const AGENTS = [
  { username: 'daniel', displayName: 'Daniel', password: 'demo-pass-123' },
  { username: 'meiling', displayName: 'Mei Ling', password: 'demo-pass-123' },
];
const CUSTOMERS = [
  ['60123110021@s.whatsapp.net', 'Nurul Huda', 'Can you cater 40 pax on Saturday?', 2],
  ['60125550142@s.whatsapp.net', 'Ahmad Zulkifli', 'Is the kopi o kosong still RM2.50?', 1],
  ['60127020388@s.whatsapp.net', 'Tan Wei Ming', 'Thank you, see you tomorrow!', 1],
  [
    '60126677889@s.whatsapp.net',
    'Siti Aminah',
    'Please send the menu for a wedding buffet with a very long name that wraps',
    2,
  ],
  ['60125550142@s.whatsapp.net', 'Ahmad Zulkifli', 'Also: do you do office lunch boxes?', 2],
];

for (let i = 0; ; i++) {
  const ok = await globalThis.fetch(`${base}/api/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (ok) break;
  if (i > 120) throw new Error('server did not start');
  await new Promise((r) => setTimeout(r, 500));
}
// Same fallback as playwright.config.ts: the installed Chrome when the bundled one is missing.
const browser = existsSync(chromium.executablePath())
  ? await chromium.launch()
  : await chromium.launch({ channel: 'chrome' });
async function ctx(opts = {}) {
  const c = await browser.newContext({
    baseURL: base,
    locale: 'en-US',
    serviceWorkers: 'block',
    ...opts,
  });
  return c;
}
async function api(req, method, path, data) {
  const r = await req.fetch(path, { method, data, headers: H });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.json().catch(() => null);
}

const setup = await ctx();
const req = setup.request;
const seeded = !(await (await req.get('/api/setup/status')).json()).needsSetup;
if (!seeded) await api(req, 'POST', '/api/setup/admin', ADMIN);
await api(req, 'POST', '/api/auth/login', { username: ADMIN.username, password: ADMIN.password });
const ids = {};
for (const a of seeded ? [] : AGENTS) {
  const u = await api(req, 'POST', '/api/users', { ...a, role: 'agent' });
  ids[a.username] = u.id;
}
if (!seeded) {
  await api(req, 'PATCH', '/api/inboxes/1', { name: 'Kopi Apong' });
  await api(req, 'POST', '/api/inboxes', { name: 'Catering', memberIds: [ids.meiling] });
  await api(req, 'POST', '/api/dev/fake-link', { inboxId: 2 });
  await api(req, 'PUT', `/api/users/${ids.daniel}/inboxes`, { inboxIds: [1] });
  await api(req, 'PUT', `/api/users/${ids.meiling}/inboxes`, { inboxIds: [2] });
  for (const [jid, name, text, inboxId] of CUSTOMERS)
    await api(req, 'POST', '/api/dev/fake-incoming', {
      chatJid: jid,
      text,
      senderName: name,
      inboxId,
    });
  // A third inbox that still waits for its scan (shows the QR state and the banner).
  await api(req, 'POST', '/api/inboxes', { name: 'Online shop', memberIds: [] });
}

// Each agent signs in once and sets a new password.
async function signedIn(user, opts) {
  const c = await ctx(opts);
  const p = await c.newPage();
  await p.goto('/login');
  await p.getByLabel('Username').fill(user.username);
  await p.getByLabel('Password', { exact: true }).fill(user.password);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForLoadState('networkidle');
  if (p.url().endsWith('/change-password')) {
    await p.getByLabel('Current password').fill(user.password);
    await p.getByLabel('New password', { exact: true }).fill(user.password + 'x');
    await p.getByLabel('Confirm new password').fill(user.password + 'x');
    await p.getByRole('button', { name: 'Save password' }).click();
    await p.waitForLoadState('networkidle');
    user.password += 'x';
  }
  return p;
}

const VIEWS = [
  ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
  [
    'mobile',
    { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
];
const shot = async (p, name) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(out, `${name}.png`) });
  const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sw > 0) console.log(`OVERFLOW ${name}: +${sw}px`);
};

for (const scheme of ['light', 'dark']) {
  for (const [view, opts] of VIEWS) {
    const tag = `${view}-${scheme}`;
    const p = await signedIn(ADMIN, { ...opts, colorScheme: scheme });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto('/');
    await p.getByText('Nurul Huda').filter({ visible: true }).first().waitFor();
    await shot(p, `01-inbox-list-${tag}`);
    await p.getByRole('combobox', { name: 'Inbox' }).filter({ visible: true }).click();
    await shot(p, `02-inbox-filter-${tag}`);
    await p.keyboard.press('Escape');
    await p.goto(`/chats/${encodeURIComponent('60125550142@s.whatsapp.net#2')}`);
    await p.getByText('office lunch boxes').filter({ visible: true }).first().waitFor();
    await shot(p, `03-conversation-${tag}`);
    await p.goto('/admin/inboxes');
    await p.getByTestId('inbox-card').filter({ visible: true }).first().waitFor();
    await shot(p, `04-admin-inboxes-${tag}`);
    await p.getByRole('button', { name: 'Edit · Catering' }).click();
    await p.getByRole('dialog').waitFor();
    await shot(p, `05-edit-inbox-${tag}`);
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Edit · Online shop' }).click();
    await p
      .getByRole('dialog')
      .getByTestId('inbox-qr')
      .waitFor()
      .catch(() => {});
    await shot(p, `06-inbox-qr-${tag}`);
    await p.keyboard.press('Escape');
    // The demo fills the limit (3): Add inbox is disabled and the limit text shows.
    await p.getByTestId('inbox-limit').scrollIntoViewIfNeeded();
    await shot(p, `07-inbox-limit-${tag}`);
    await p.goto('/admin/members');
    await p.getByText('Mei Ling').filter({ visible: true }).first().waitFor();
    await shot(p, `08-members-${tag}`);
    if (errors.length) console.log(`PAGEERROR ${tag}: ${errors.join(' | ')}`);
    await p.context().close();
  }
}
for (const [view, opts] of VIEWS) {
  const p = await signedIn(AGENTS[0], opts);
  await p.goto('/');
  await p.getByText('Ahmad Zulkifli').filter({ visible: true }).first().waitFor();
  await shot(p, `09-agent-daniel-list-${view}`);
  await p.goto(`/chats/${encodeURIComponent('60123110021@s.whatsapp.net#2')}`);
  await p.waitForTimeout(800);
  await shot(p, `10-agent-no-access-${view}`);
  await p.context().close();
}
await browser.close();
console.log('done');

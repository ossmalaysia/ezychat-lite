// Screens of Edit member -> Only chosen chats (the add-chats picker): empty search, number search, same-named
// groups, chosen excluded. Fresh fake-WhatsApp server only:
//   npm run build -w @ezychat/web
//   npx tsx packages/server/src/cli.ts --data <tmp> --port 7478 --fake-wa --mode dev --max-inboxes 2 --web-dist apps/web/dist
//   node e2e/member-chats-screens.mjs 7478 docs/screenshots/member-chats
/* global window, getComputedStyle -- used inside addInitScript and page.evaluate (run in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const PORT = Number.parseInt(process.argv[2] ?? '7478', 10);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535)
  throw new Error('Usage: node e2e/member-chats-screens.mjs <port> [outDir]');
const BASE = `http://127.0.0.1:${PORT}`;
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'docs/screenshots/member-chats');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
const PASSWORD = 'demo-pass-123';
const headers = { 'content-type': 'application/json', origin: BASE };

const setup = await fetch(`${BASE}/api/setup/admin`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ username: 'aisyah', displayName: 'Aisyah', password: PASSWORD }),
});
if (!setup.ok) throw new Error(`setup ${setup.status} (use a fresh --data dir)`);
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ username: 'aisyah', password: PASSWORD }),
});
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const call = async (method, path, body) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...headers, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json().catch(() => null);
};

await call('POST', '/users', {
  username: 'bob',
  displayName: 'Bob Agent',
  role: 'agent',
  password: `${PASSWORD}-tmp`,
});
const old = '60177777777@s.whatsapp.net';
await call('POST', '/dev/fake-incoming', { chatJid: old, senderName: 'Old Customer', text: 'Hi' });
await call('PATCH', `/chats/${encodeURIComponent(old)}`, { status: 'resolved' });
const names = ['Farah Aziz', 'Daniel Tan', 'Mei Ling', 'Ravi Kumar', 'Siti Noor', 'Ah Meng'];
for (const [i, name] of names.entries())
  await call('POST', '/dev/fake-incoming', {
    chatJid: `601230010${String(i).padStart(2, '0')}@s.whatsapp.net`,
    senderName: name,
    text: 'Hello',
  });
for (const id of ['120363000000000011@g.us', '120363000000000022@g.us'])
  await call('POST', '/dev/fake-group', { groupJid: id, name: 'AS x Kaki Deco', generated: 3 });

// A second linked number with the same group on both numbers (two chats, one per inbox)
await call('POST', '/inboxes', { name: 'Anchor SG', memberIds: [] });
await call('POST', '/dev/fake-link', { inboxId: 2 });
for (const inboxId of [1, 2])
  await call('POST', '/dev/fake-group', {
    inboxId,
    groupJid: '120363000000000033@g.us',
    name: 'Anchor Regulars',
    generated: 3,
  });

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
mkdirSync(OUT, { recursive: true });
for (const theme of ['light', 'dark']) {
  for (const [vp, size] of [
    ['desktop', { width: 1280, height: 900 }],
    ['mobile', { width: 360, height: 780 }],
  ]) {
    const ctx = await browser.newContext({
      viewport: size,
      baseURL: BASE,
      colorScheme: theme,
      deviceScaleFactor: 2,
    });
    await ctx.addCookies(
      cookie.split('; ').map((c) => {
        const [name, ...v] = c.split('=');
        return { name, value: v.join('='), url: BASE };
      }),
    );
    await ctx.addInitScript(() => window.localStorage.setItem('wati.locale', 'en'));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/admin/members');
    const row = page.locator('tr:visible, li:visible').filter({ hasText: 'Bob Agent' }).first();
    await row.waitFor();
    await row.getByRole('button', { name: /Edit/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('radio', { name: /Only chosen chats/ }).click();
    const field = dialog.getByTestId('member-chats');
    const search = field.getByRole('searchbox');
    const shot = async (name) => {
      await page.waitForTimeout(700);
      // the dialog body scrolls: bring the end of the add list into view so every result shows
      await field.evaluate((el) => {
        for (let e = el; e; e = e.parentElement)
          if (e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY === 'auto') {
            e.scrollTop = e.scrollHeight;
            break;
          }
      });
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT, `${name}-${vp}-${theme}.png`) });
      console.log(`${name}-${vp}-${theme}.png`);
    };
    await field.getByRole('button', { name: /^Add Old Customer/ }).waitFor();
    await shot('1-empty-search');
    await search.fill('+60 17-777 7777');
    await field.getByRole('button', { name: /^Add Old Customer/ }).waitFor();
    await shot('2-number-search');
    await search.fill('kaki');
    await field
      .getByRole('button', { name: /^Add AS x Kaki Deco/ })
      .first()
      .waitFor();
    await shot('3-same-named-groups');
    await field
      .getByRole('button', { name: /^Add AS x Kaki Deco/ })
      .first()
      .click();
    await field
      .getByRole('button', { name: /^Add Old Customer/ })
      .waitFor({ state: 'detached' })
      .catch(() => {});
    await search.fill('');
    await shot('4-chosen-excluded');
    await search.fill('regulars');
    await field
      .getByRole('button', { name: /^Add Anchor Regulars/ })
      .nth(1)
      .waitFor();
    await shot('5-same-group-two-inboxes');
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    await ctx.close();
  }
}
await browser.close();

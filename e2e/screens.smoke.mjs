// Screen smoke test: renders every screen (desktop + mobile) against a server with fake WhatsApp and reports
// page crashes, console errors, failed API calls and blank screens, saving a screenshot of each.
// Usage: node e2e/screens.smoke.mjs <baseUrl> <outDir>      (server must run with --fake-wa, fresh data dir)
// SMOKE_LOCALE=ms|zh-CN renders every screen in that UI language (default en) to catch overflow from longer text.
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:7499';
const OUT = process.argv[3] ?? 'test-results/screens';
mkdirSync(OUT, { recursive: true });

const ADMIN = { username: 'smoke', displayName: 'Smoke Admin', password: 'smoke-pass-123' };
const CHAT = '60123456789@s.whatsapp.net';
const ROUTES = [
  ['inbox', '/'],
  ['conversation', `/chats/${encodeURIComponent(CHAT)}`],
  ['conversation-customer', `/chats/${encodeURIComponent(CHAT)}?customer=1`],
  ['admin-members', '/admin/members'],
  ['admin-members-ai', '/admin/members/ai'],
  ['admin-quick-replies', '/admin/quick-replies'],
  ['admin-whatsapp', '/admin/whatsapp'],
  ['admin-tunnel', '/admin/tunnel'],
  ['admin-settings', '/admin/settings'],
  ['admin-settings-ai', '/admin/settings/ai'],
  ['admin-settings-integrations', '/admin/settings/integrations'],
  ['admin-settings-device', '/admin/settings/device'],
  ['admin-settings-maintenance', '/admin/settings/maintenance'],
  ['admin-audit', '/admin/audit'],
  ['change-password', '/change-password'],
];
const LOCALE = process.env.SMOKE_LOCALE ?? 'en';
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

// Prefer the bundled browser; fall back to the locally installed Chrome when it isn't downloaded.
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const results = [];

async function check(page, name) {
  const errors = [];
  const onErr = (e) => errors.push(`pageerror: ${e.message}`);
  // A logged-out visit to /setup or /login probes /api/me and gets the expected 401.
  const expected401 = name === 'setup' || name === 'login';
  const onConsole = (m) =>
    m.type() === 'error' &&
    !(expected401 && m.text().includes('401')) &&
    errors.push(`console: ${m.text().slice(0, 200)}`);
  const onResp = (r) =>
    r.url().includes('/api/') && r.status() >= 500 && errors.push(`api ${r.status()}: ${r.url()}`);
  page.on('pageerror', onErr);
  page.on('console', onConsole);
  page.on('response', onResp);
  return async (vp) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    const text = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).trim();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (text.length < 20) errors.push(`blank screen (${text.length} chars of text)`);
    if (overflow > 1) errors.push(`horizontal overflow ${overflow}px`);
    await page.screenshot({ path: join(OUT, `${name}-${vp}.png`), fullPage: false });
    page.off('pageerror', onErr);
    page.off('console', onConsole);
    page.off('response', onResp);
    results.push({ screen: name, viewport: vp, ok: errors.length === 0, errors });
  };
}

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: size, baseURL: BASE, locale: LOCALE });
  await ctx.addInitScript((l) => window.localStorage.setItem('wati.locale', l), LOCALE);
  const page = await ctx.newPage();

  if (vp === 'desktop') {
    // first run: setup wizard + login screens, then create the admin through the API
    let done = await check(page, 'setup');
    await page.goto('/setup');
    await done(vp);
    const r = await page.request.post('/api/setup/admin', {
      data: ADMIN,
      headers: { origin: BASE },
    });
    if (!r.ok()) throw new Error(`setup failed ${r.status()} ${await r.text()}`);
    await page.request.post('/api/auth/logout', { headers: { origin: BASE } });
  }
  let done = await check(page, 'login');
  await page.goto('/login');
  await done(vp);
  const login = await page.request.post('/api/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login failed ${login.status()}`);
  if (vp === 'desktop') {
    for (const text of ['Hi, I need help with my order', 'Is anyone there?']) {
      await page.request.post('/api/dev/fake-incoming', {
        data: { chatJid: CHAT, text, senderName: 'Customer' },
        headers: { origin: BASE },
      });
    }
    // A long CJK profile name and tags exercise truncation in the list, header and panel.
    const profile = await page.request.put(`/api/chats/${encodeURIComponent(CHAT)}/profile`, {
      data: {
        name: '陈伟杰（槟城分店采购负责人）',
        company: 'Syarikat Perdagangan Pulau Pinang Sdn Bhd',
        email: 'procurement@example.com',
        address: 'Lebuh Chulia, George Town',
        tags: ['VIP', 'Wholesale', 'Halal catering'],
      },
      headers: { origin: BASE },
    });
    if (!profile.ok()) throw new Error(`profile seed failed ${profile.status()}`);
  }
  for (const [name, path] of ROUTES) {
    done = await check(page, name);
    await page.goto(path);
    await done(vp);
  }
  await ctx.close();
}
await browser.close();

for (const r of results)
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}  ${r.viewport.padEnd(7)} ${r.screen}${r.ok ? '' : '\n      ' + r.errors.join('\n      ')}`,
  );
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} screens OK — screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);

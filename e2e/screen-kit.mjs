// Shared setup of the screen-review scripts (agent-screens, claims-template-screens): a browser, contexts
// against a local Dev Build, an API helper with the Origin header, the first admin, viewports and shots.
// Never calls a model or a real WhatsApp number.
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

export const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };

/** Desktop 1280 and phone 360 (touch). */
export const VIEWS = [
  ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'mobile',
    { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
];

export async function screenKit(base, out) {
  mkdirSync(out, { recursive: true });
  const headers = { Origin: base };
  const browser = existsSync(chromium.executablePath())
    ? await chromium.launch()
    : await chromium.launch({ channel: 'chrome' });
  const ctx = (opts = {}) =>
    browser.newContext({ baseURL: base, locale: 'en-US', serviceWorkers: 'block', ...opts });
  async function api(req, method, path, data) {
    const r = await req.fetch(path, { method, data, headers });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json().catch(() => null);
  }
  /** A signed-in admin context (creates the first admin on empty data). */
  async function adminContext() {
    const c = await ctx();
    if ((await (await c.request.get('/api/setup/status')).json()).needsSetup)
      await api(c.request, 'POST', '/api/setup/admin', ADMIN);
    await api(c.request, 'POST', '/api/auth/login', {
      username: ADMIN.username,
      password: ADMIN.password,
    });
    return c;
  }
  /** Screenshot plus an OVERFLOW line when the page scrolls sideways. */
  async function shot(p, name, fullPage = false) {
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(out, `${name}.png`), fullPage });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sw > 0) console.log(`OVERFLOW ${name}: +${sw}px`);
  }
  return { browser, ctx, api, adminContext, shot };
}

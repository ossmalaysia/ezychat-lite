// Shared setup for the screenshot scripts that run against a fresh standalone server with --fake-wa
// (e2e/*-screens.mjs): port and output folder from argv, the demo admin, API calls, the browser and the
// two screen sizes. New scripts use this; older ones still carry their own copy.
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const DEMO_ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };

/** Desktop 1280×800 and phone 360×780, both at 2× pixel density (docs/screenshots/README.md). */
export const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  mobile: {
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

/** `<port> <outDir>` from argv; screenshots go only inside this repository or the system temp folder. */
export function screensArgs(defaultDir) {
  const port = Number(process.argv[2] ?? 7477);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('The port must be an integer between 1024 and 65535.');
  const inside = (base, path) => {
    const rel = relative(base, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  const repo = resolve(import.meta.dirname, '..');
  const out = resolve(repo, process.argv[3] ?? defaultDir);
  if (!inside(repo, out) && !inside(resolve(tmpdir()), out))
    throw new Error('The output folder must be inside the repository or the temp folder.');
  mkdirSync(out, { recursive: true });
  return { base: `http://127.0.0.1:${port}`, out };
}

/** A POST to the server's API with Origin (and the session cookie once signed in). */
export async function apiPost(base, path, body, cookie = '') {
  const res = await fetch(base + '/api' + path, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? cookie };
}

/** Creates the demo admin on a fresh server, signs in and returns the session cookie. */
export async function signInDemoAdmin(base) {
  if ((await (await fetch(base + '/api/setup/status')).json()).needsSetup)
    await apiPost(base, '/setup/admin', DEMO_ADMIN);
  const { cookie } = await apiPost(base, '/auth/login', {
    username: DEMO_ADMIN.username,
    password: DEMO_ADMIN.password,
  });
  return cookie;
}

export const launchBrowser = () =>
  chromium
    .launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
    .catch(() => chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' }));

/** A browser context per scheme and size, signed in with `cookie`; `run(ctx, tag)` takes its shots. */
export async function eachScreen(browser, base, cookie, run) {
  for (const scheme of ['light', 'dark'])
    for (const [size, options] of Object.entries(SIZES)) {
      const tag = `${size}${scheme === 'dark' ? '-dark' : ''}`;
      const ctx = await browser.newContext({ ...options, baseURL: base, colorScheme: scheme });
      const [name, value] = cookie.split('=');
      await ctx.addCookies([{ name, value, url: base }]);
      await run(ctx, tag);
      await ctx.close();
    }
}

/** Saves `<file>-<tag>.png` and records horizontal overflow as a problem. */
export async function shot(page, out, problems, tag, file) {
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
  )
    problems.push(`${tag} ${file}: horizontal overflow`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${file}-${tag}.png`) });
}

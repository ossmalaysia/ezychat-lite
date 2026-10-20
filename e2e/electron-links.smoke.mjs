// External links in the REAL desktop window: on every screen (screen-routes.mjs) every https:/mailto:
// link is clicked and must reach shell.openExternal (stubbed by electron-app-shell.mjs) while the window
// stays on its screen. A probe mailto: link is clicked on every screen too, so a screen without links
// still proves the window's navigation rules. Catches what browser e2e cannot: a desktop-only rule that
// swallows a click ("Email to activate" did nothing once).
// Usage: npm run build -w @ezychat/desktop; node e2e/electron-links.smoke.mjs <baseUrl>
// Server: --fake-wa on a temp data dir; the admin "smoke" is created if setup is needed.
/* global document -- used inside page.evaluate (runs in the window) */
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SCREEN_ROUTES, SMOKE_ADMIN, SMOKE_CHAT } from './screen-routes.mjs';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:7499').replace(/\/$/, '');
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const app = await electron.launch({
  executablePath: require('electron'),
  args: [fileURLToPath(new URL('./electron-app-shell.mjs', import.meta.url))],
  env: { ...process.env, SMOKE_BASE: BASE },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const opened = () => app.evaluate(() => globalThis.__opened.slice());

const login = await page.evaluate(
  async ({ admin, chat }) => {
    const h = { 'content-type': 'application/json' };
    const s = await (await fetch('/api/setup/status')).json();
    if (s.needsSetup)
      await fetch('/api/setup/admin', { method: 'POST', headers: h, body: JSON.stringify(admin) });
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ username: admin.username, password: admin.password }),
    });
    await fetch('/api/dev/fake-incoming', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        chatJid: chat,
        text: 'Hi, I need help with my order',
        senderName: 'Customer',
      }),
    });
    return r.status;
  },
  { admin: SMOKE_ADMIN, chat: SMOKE_CHAT },
);
if (login !== 200) throw new Error(`login failed ${login}`);

const results = [];
for (const [name, path] of SCREEN_ROUTES) {
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  const screenUrl = page.url();
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="mailto:"], a[href^="https:"]')].map((a) => a.href),
  );
  const problems = [];
  const clickAndCheck = async (selectorIndex, href, probe) => {
    const before = (await opened()).length;
    await page.evaluate(
      ({ i, probe }) => {
        if (probe) {
          const a = document.createElement('a');
          a.href = 'mailto:probe@example.com?subject=Link%20test';
          a.textContent = 'probe';
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          document.querySelectorAll('a[href^="mailto:"], a[href^="https:"]')[i].click();
        }
      },
      { i: selectorIndex, probe },
    );
    await page.waitForTimeout(300);
    const now = await opened();
    if (now.length !== before + 1 || now.at(-1) !== href)
      problems.push(`not opened in the OS: ${href} (opened ${JSON.stringify(now.slice(before))})`);
    if (page.url() !== screenUrl) {
      problems.push(`window left the screen for ${href}: ${page.url()}`);
      await page.goto(screenUrl);
      await page.waitForTimeout(500);
    }
  };
  await clickAndCheck(-1, 'mailto:probe@example.com?subject=Link%20test', true);
  for (let i = 0; i < hrefs.length; i++) await clickAndCheck(i, hrefs[i], false);
  results.push({ name, links: hrefs.length, problems });
}
await app.close();

for (const r of results)
  console.log(
    `${r.problems.length ? 'FAIL' : 'PASS'}  ${r.name.padEnd(28)} ${r.links} link(s)` +
      (r.problems.length ? '\n      ' + r.problems.join('\n      ') : ''),
  );
const failed = results.filter((r) => r.problems.length).length;
console.log(
  `\n${results.length - failed}/${results.length} screens: external links open in the OS`,
);
process.exit(failed ? 1 : 0);

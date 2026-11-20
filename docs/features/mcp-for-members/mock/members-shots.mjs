// Screenshots of the proposed "AI assistants for team members" (mcp-for-members) in the running seeded mock
// (run.ts --fake-wa): the admin's Settings → Integrations (members switch on, token list with owners and Member
// badges, the turn-off confirmation), a team member's Your account → AI assistant (switch off and on, Create access
// token, the secret shown once, the "not found" demo), a member limited to chosen chats (new numbers greyed), and the
// app sign-in approve page as a member (switch on and off). Desktop 1280 px and mobile 360 px, light and dark.
// Reports page errors and horizontal overflow. Ends with ../screenshots/members-results.json.
// Usage: node docs/features/mcp-for-members/mock/members-shots.mjs [baseUrl] [outDir]   (PW_CHROMIUM=<chromium>)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = process.argv[3] ?? join(import.meta.dirname, '..', 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const shots = [];
const scale = Number(process.env.DSF ?? 2);
const sizes = {
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: scale },
  mobile: {
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: scale,
  },
};

async function session(user, sizeName, scheme) {
  const ctx = await browser.newContext({ ...sizes[sizeName], baseURL: BASE, colorScheme: scheme });
  await ctx.addInitScript(() => localStorage.setItem('wati.locale', 'en'));
  const login = await ctx.request.post('/api/auth/login', {
    data: { username: user, password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login ${user} failed ${login.status()}`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const suffix = `${sizeName === 'desktop' ? 'd1280' : 'm360'}-${scheme}`;
  page.on('pageerror', (e) => problems.push(`${user} ${suffix} pageerror: ${e.message}`));
  const shot = async (name, { overlay = false } = {}) => {
    await page.waitForTimeout(500);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (wide) problems.push(`${user} ${suffix} ${name}: horizontal overflow`);
    // An overlay dialog may scroll inside itself; only the page itself must not overflow sideways.
    void overlay;
    const file = `${name}-${suffix}.png`;
    await page.screenshot({ path: join(OUT, file) });
    shots.push(file);
  };
  return { ctx, page, shot };
}

async function openIntegrations(page) {
  await page.goto('/admin/settings?tab=integrations');
  await page
    .getByRole('tab', { name: /Integrations/ })
    .click()
    .catch(() => undefined);
  await page.getByTestId('members-switch-row').waitFor();
}

for (const scheme of ['light', 'dark'])
  for (const sizeName of ['desktop', 'mobile']) {
    // 1. Admin: Settings → Integrations, switch on, token list; then turning it off asks first.
    {
      const { ctx, page, shot } = await session('aisyah', sizeName, scheme);
      await page.goto('/?members=1');
      await openIntegrations(page);
      await page.getByTestId('members-switch-row').scrollIntoViewIfNeeded();
      await shot('admin-integrations-switch');
      await page.getByTestId('token-member').first().scrollIntoViewIfNeeded();
      const rows = await page.getByTestId('token-member').count();
      if (rows !== 2) problems.push(`admin ${sizeName}: expected 2 Member badges, got ${rows}`);
      await shot('admin-integrations-tokens');
      await page.getByRole('switch', { name: /Members can connect/ }).click();
      await page.getByRole('alertdialog').waitFor();
      await shot('admin-turn-off-dialog', { overlay: true });
      await ctx.close();
    }
    // 2. Daniel (team member): the switch off, then on, Create token and the secret.
    {
      const { ctx, page, shot } = await session('daniel', sizeName, scheme);
      await page.goto('/account?members=0');
      await page.getByTestId('member-assistant-off').waitFor();
      await shot('member-account-off');
      await page.goto('/account?members=1');
      await page.getByTestId('member-assistant-reach').waitFor();
      await page.getByTestId('member-assistant').scrollIntoViewIfNeeded();
      await shot('member-account-on');
      await page.getByTestId('member-assistant-reach').scrollIntoViewIfNeeded();
      await page.getByTestId('members-mock-panel').scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Show the answer' }).click();
      await page.getByTestId('members-not-found').waitFor();
      await shot('member-not-found-demo');
      await page.getByRole('button', { name: 'Create access token' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Name').fill('Claude – laptop');
      await dlg.getByRole('checkbox', { name: /Can send WhatsApp messages/ }).click();
      await dlg.getByRole('checkbox', { name: /Can also message new numbers/ }).waitFor();
      await shot('member-create-token', { overlay: true });
      await dlg.getByRole('button', { name: 'Create token' }).click();
      await dlg.getByTestId('api-token-secret').waitFor();
      await shot('member-secret-shown', { overlay: true });
      await dlg.getByRole('button', { name: 'Done' }).click();
      await page.getByTestId('member-token-row').filter({ hasText: 'Claude – laptop' }).waitFor();
      await ctx.close();
    }
    // 3. Ravi (limited to chosen chats): the reach line and the greyed "new numbers" box.
    {
      const { ctx, page, shot } = await session('ravi', sizeName, scheme);
      await page.goto('/account?members=1');
      await page.getByTestId('member-assistant-reach').waitFor();
      const reach = await page.getByTestId('member-assistant-reach').innerText();
      if (!/only the \d+ chats? chosen/.test(reach)) problems.push(`ravi reach line: ${reach}`);
      await page.getByTestId('member-assistant').scrollIntoViewIfNeeded();
      await shot('ravi-account-on');
      await page.getByRole('button', { name: 'Create access token' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Name').fill('Claude – desk');
      const newBox = dlg.getByRole('checkbox', { name: /Can also message new numbers/ });
      await newBox.waitFor();
      if (!(await newBox.isDisabled())) problems.push('ravi: new numbers must be greyed out');
      await dlg.getByRole('button', { name: /Why is this greyed out/ }).click();
      await page
        .getByText("You can't start new chats in EzyChat, so your assistant can't either.")
        .first()
        .waitFor();
      await shot('ravi-create-token-greyed', { overlay: true });
      await ctx.close();
    }
    // 4. App sign-in approve page as Daniel: switch on, then off.
    {
      const { ctx, page, shot } = await session('daniel', sizeName, scheme);
      await page.goto('/oauth/authorize?mock=1&members=1');
      await page.getByTestId('oauth-ask').waitFor();
      await shot('oauth-approve');
      await page.getByRole('button', { name: 'Allow', exact: true }).click();
      await page.getByTestId('oauth-approved').waitFor();
      await shot('oauth-approved');
      await page.goto('/oauth/authorize?mock=1&members=0');
      await page.getByTestId('oauth-off').waitFor();
      await shot('oauth-members-off');
      await page.goto('/?members=1');
      await ctx.close();
    }
  }
await browser.close();
writeFileSync(join(OUT, 'members-results.json'), JSON.stringify({ shots, problems }, null, 2));
console.log(problems.length ? problems.join('\n') : `no problems (${shots.length} screenshots)`);

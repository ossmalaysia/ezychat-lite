// Screenshots of the proposed token-permissions UI in the running seeded mock (run.ts --fake-wa): the token
// list with its Permissions buttons, the Permissions dialog as opened (can send), with "new numbers"
// ticked (ban warning) and after Save (badges updated), at desktop 1280 px and mobile 360 px. Reports
// page errors and horizontal overflow. Usage: node docs/features/token-permissions/mock/perm-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7487';
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium
  .launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
  .catch(() => chromium.launch({ channel: 'chrome' }));
const problems = [];

for (const [vp, size] of [
  ['desktop', { width: 1280, height: 860 }],
  ['mobile', { width: 360, height: 780 }],
]) {
  const ctx = await browser.newContext({ viewport: size, baseURL: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${vp} pageerror: ${e.message}`));
  const shot = async (n, step) => {
    await page.waitForTimeout(600);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (wide) problems.push(`${vp} ${step}: horizontal overflow`);
    await page.screenshot({ path: join(OUT, `${n}-${step}-${vp}.png`) });
  };

  const login = await ctx.request.post('/api/auth/login', {
    data: { username: 'aisyah', password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login failed ${login.status()}`);

  await page.goto('/admin/settings/integrations');
  const row = page.getByTestId('api-token-row').filter({ hasText: 'Claude – office laptop' });
  await row.waitFor();
  await row.scrollIntoViewIfNeeded();
  await shot('01', 'token-list', vp);

  await row.getByRole('button', { name: /Change what token/ }).click();
  const dialog = page.getByRole('dialog', { name: /Permissions of/ });
  await dialog.getByRole('checkbox', { name: 'Can send WhatsApp messages' }).waitFor();
  await shot('02', 'permissions-dialog', vp);
  const canNew = dialog.getByRole('checkbox', { name: 'Can also message new numbers' });
  // The desktop pass saved it already; the mobile pass then opens it ticked.
  if ((await canNew.getAttribute('aria-checked')) !== 'true') await canNew.click();
  await dialog.getByText('Risk of a WhatsApp ban').scrollIntoViewIfNeeded();
  await shot('03', 'permissions-new-numbers', vp);
  // Desktop saves (the mobile pass then shows the saved state); mobile only looks.
  if (vp === 'desktop') {
    await dialog.getByRole('button', { name: 'Save' }).click();
    await row.getByText('New numbers', { exact: true }).waitFor();
    await shot('04', 'saved', vp);
  } else {
    await page.keyboard.press('Escape');
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no page errors, no horizontal overflow');
process.exit(problems.length ? 1 : 0);

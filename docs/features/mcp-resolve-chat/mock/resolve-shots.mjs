// Screenshots of the proposed "Can resolve chats" token permission (mcp-resolve-chat) in the running seeded
// mock (run.ts --fake-wa): Settings → Integrations token list with the badge, Create access token with the
// box ticked, and Permissions of the triage token; desktop 1280 px and mobile 360 px, light and dark.
// Reports page errors and horizontal overflow.
// Usage: node docs/features/mcp-resolve-chat/mock/resolve-shots.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = process.argv[3] ?? join(import.meta.dirname, '..', 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 900 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    const ctx = await browser.newContext({ ...size, baseURL: BASE, colorScheme: scheme });
    const login = await ctx.request.post('/api/auth/login', {
      data: { username: 'aisyah', password: 'demo-pass-123' },
      headers: { origin: BASE },
    });
    if (!login.ok()) throw new Error(`login failed ${login.status()}`);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const overflow = async (name) => {
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      if (wide) problems.push(`${suffix} ${name}: horizontal overflow`);
    };
    const shot = async (name) => {
      await page.waitForTimeout(400);
      await overflow(name);
      await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`) });
    };
    await page.goto('/admin/settings?tab=integrations');
    await page.getByRole('tab', { name: /Integrations/ }).click().catch(() => undefined);
    const row = page.getByTestId('api-token-row').filter({ hasText: 'inbox triage' });
    await row.scrollIntoViewIfNeeded();
    await shot('token-list');
    await row.getByRole('button', { name: /Change what token/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('checkbox', { name: /Can resolve chats/ }).waitFor();
    await shot('permissions-triage');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Create token' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name').fill('Claude – inbox triage 2');
    await create.getByRole('checkbox', { name: /Can resolve chats/ }).click();
    await create.getByRole('checkbox', { name: /Can resolve chats/ }).scrollIntoViewIfNeeded();
    await shot('create-can-resolve');
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no problems');

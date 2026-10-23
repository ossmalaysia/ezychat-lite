// Screenshots of the proposed "Images from customers" card in the running seeded mock (run.ts --fake-wa),
// desktop 1280 px and mobile 360 px, light and dark: Detailed (the default), Fast after a click, and the
// note that replaces the choice under the Claude connection. Reports page errors and horizontal overflow.
// Usage: node docs/features/ai-image-detail/mock/image-detail-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7481';
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium
  .launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
  .catch(() => chromium.launch({ channel: 'chrome' }));
const problems = [];

for (const scheme of ['light', 'dark'])
  for (const [vp, size] of [
    ['desktop', { width: 1280, height: 900 }],
    ['mobile', { width: 360, height: 780 }],
  ]) {
    const ctx = await browser.newContext({ viewport: size, baseURL: BASE, colorScheme: scheme });
    const login = await ctx.request.post('/api/auth/login', {
      data: { username: 'aisyah', password: 'demo-pass-123' },
      headers: { origin: BASE },
    });
    if (!login.ok()) throw new Error(`login failed ${login.status()}`);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${scheme} ${vp} pageerror: ${e.message}`));
    const open = async () => {
      await page.goto('/admin/settings/ai');
      await page.getByText('More AI features').click({ timeout: 90_000 });
      const card = page.getByTestId('ai-images');
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      return card;
    };
    const shot = async (n, step, card) => {
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        problems.push(`${scheme} ${vp} ${step}: horizontal overflow`);
      await card.screenshot({ path: join(OUT, `${n}-${step}-${vp}-${scheme}.png`) });
    };
    let card = await open();
    await shot('01', 'detailed-default', card);
    await card.getByText('Fast', { exact: true }).click();
    await page.waitForTimeout(300);
    await shot('02', 'fast', card);
    await page.evaluate(() =>
      localStorage.setItem(
        'mock.claudeProvider.v1',
        JSON.stringify({ active: true, hasKey: true, model: '', openAiStandIn: true }),
      ),
    );
    card = await open();
    await shot('03', 'claude-note', card);
    await page.evaluate(() => {
      localStorage.removeItem('mock.claudeProvider.v1');
      localStorage.removeItem('mock.imageDetail.v1');
    });
    await page.goto('/admin/settings/ai');
    await page.getByText('More AI features').click({ timeout: 90_000 });
    await page.getByTestId('ai-images').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `04-page-${vp}-${scheme}.png`) });
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? problems.join('\n') : 'No page errors or horizontal overflow.');
console.log(`Saved the ai-image-detail screenshots in ${OUT}`);

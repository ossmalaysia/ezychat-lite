// Screenshots of the proposed MCP-send UI in the running seeded mock (run.ts --fake-wa): the token
// list with its "Can send" badge, the Create token dialog with the new checkbox (off and ticked) and
// a chat reply sent through the assistant, the "Can also message new numbers" option with its ban warning
// and a chat the assistant started with a new number, at desktop 1280 px and mobile 360 px. Reports page errors
// and horizontal overflow. Usage: node docs/features/mcp-send-message/mock/send-shots.mjs [baseUrl]
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
  const overflow = async (step) => {
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (wide) problems.push(`${vp} ${step}: horizontal overflow`);
  };
  const shot = async (n, step) => {
    await page.waitForTimeout(600);
    await overflow(step);
    await page.screenshot({ path: join(OUT, `${n}-${step}-${vp}.png`) });
  };

  // Sign in through the API (the cookie lands in this browser context).
  const login = await ctx.request.post('/api/auth/login', {
    data: { username: 'aisyah', password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login failed ${login.status()}`);

  await page.goto('/admin/settings/integrations');
  await page.getByTestId('api-token-row').first().waitFor();
  await page.getByTestId('token-can-send').first().scrollIntoViewIfNeeded();
  await shot('01', 'token-list', vp);

  await page
    .getByRole('button', { name: /create token/i })
    .first()
    .click();
  const canSend = page.getByRole('checkbox', { name: /can send whatsapp messages/i });
  await canSend.waitFor();
  await shot('02', 'create-dialog', vp);
  await canSend.click();
  await page.getByText(/Replies go straight to your customers/).waitFor();
  await shot('03', 'create-dialog-can-send', vp);
  await page.getByRole('checkbox', { name: /also message new numbers/i }).click();
  const ban = page.getByText(/Risk of a WhatsApp ban/);
  await ban.waitFor();
  await ban.scrollIntoViewIfNeeded();
  await shot('05', 'create-dialog-new-numbers', vp);
  await page.keyboard.press('Escape');

  await page.goto(`/chats/${encodeURIComponent('60123110021@s.whatsapp.net')}`);
  await page.getByTestId('via-assistant').first().waitFor();
  await page.getByTestId('via-assistant').first().scrollIntoViewIfNeeded();
  await shot('04', 'chat-via-assistant', vp);

  await page.goto(`/chats/${encodeURIComponent('60139990001@s.whatsapp.net')}`);
  await page.getByTestId('started-by-assistant').waitFor();
  await shot('06', 'chat-started-by-assistant', vp);
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no page errors, no horizontal overflow');
process.exit(problems.length ? 1 : 0);

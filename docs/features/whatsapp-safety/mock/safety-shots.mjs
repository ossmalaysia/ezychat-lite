// Screenshots of the proposed WhatsApp Safety (whatsapp-safety) in the running seeded mock
// (run.ts --fake-wa), at desktop 1280 px and mobile 360 px (touch), light and dark: the admin Safety
// page (flagged list, item details, report dialog, blocked numbers, settings), the chat warnings
// (ZIP lure for an admin and locked for an agent, fake bank link, hacked customer bar) and auto-block.
// Reports page errors and horizontal overflow; ends with safety-results.json.
// Usage: node docs/features/whatsapp-safety/mock/safety-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
// PW_CHROMIUM or PW_CHANNEL pick a browser; otherwise Playwright's own Chromium.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM
    ? { executablePath: process.env.PW_CHROMIUM }
    : process.env.PW_CHANNEL
      ? { channel: process.env.PW_CHANNEL }
      : {},
);
const problems = [];
const passed = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
const chat = (digits) => `/chats/${encodeURIComponent(`${digits}@s.whatsapp.net`)}`;

async function signIn(size, scheme, username) {
  const ctx = await browser.newContext({ ...size, baseURL: BASE, colorScheme: scheme });
  const login = await ctx.request.post('/api/auth/login', {
    data: { username, password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login ${username} failed ${login.status()}`);
  const page = await ctx.newPage();
  return { ctx, page };
}

const run = async (suffix, page, name, check) => {
  page.removeAllListeners('pageerror');
  page.on('pageerror', (e) => problems.push(`${suffix} ${name} pageerror: ${e.message}`));
  try {
    await check();
  } catch (e) {
    problems.push(`${suffix} ${name}: ${e.message.split('\n')[0]}`);
    return;
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
  await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`) });
  passed.push(`${name}-${suffix}`);
};

for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    const admin = await signIn(size, scheme, 'aisyah');
    const p = admin.page;

    await run(suffix, p, 'safety-list', async () => {
      await p.goto('/admin/safety');
      await p.getByTestId('safety-row').first().waitFor();
      const rows = await p.getByTestId('safety-row').count();
      if (rows !== 4) throw new Error(`expected 4 rows to review, got ${rows}`);
    });
    await run(suffix, p, 'safety-all', async () => {
      await p.getByTestId('safety-page').getByText('All', { exact: true }).click();
      await p.locator('[data-scenario="falseAlarm"]').waitFor();
    });
    await run(suffix, p, 'safety-item', async () => {
      await p.locator('[data-scenario="zipLure"]').click();
      const sheet = p.getByTestId('safety-sheet');
      await sheet.waitFor();
      await p.waitForTimeout(400);
      const text = await sheet.textContent();
      for (const want of [
        'Statement_of_Account_Oct2026.pdf.vbs',
        'AI check: High risk',
        'Daniel tried',
      ])
        if (!text.includes(want)) throw new Error(`sheet misses "${want}"`);
    });
    await run(suffix, p, 'safety-report', async () => {
      await p.getByTestId('safety-report').click();
      const dialog = p.getByTestId('safety-report-dialog');
      await dialog.waitFor();
      await p.waitForTimeout(400);
      if (!(await dialog.textContent()).includes('997')) throw new Error('report misses NSRC 997');
    });
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');

    await run(suffix, p, 'safety-hacked-item', async () => {
      await p.goto('/admin/safety');
      await p.locator('[data-scenario="hackedCustomer"]').click();
      const text = await p.getByTestId('safety-sheet').textContent();
      if (!text.includes('Existing customer'))
        throw new Error('hacked item misses "Existing customer"');
    });
    await p.keyboard.press('Escape');

    await run(suffix, p, 'safety-settings', async () => {
      await p.getByRole('tab', { name: 'Settings' }).click();
      await p.getByTestId('safety-settings').waitFor();
    });

    await run(suffix, p, 'report-safety', async () => {
      await p.goto('/admin/reports');
      const section = p.getByTestId('report-safety');
      await section.waitFor();
      await p.getByTestId('safety-risky-downloads').waitFor();
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: join(OUT, `report-safety-full-${suffix}.png`) });
    });
    await run(suffix, p, 'chat-zip-admin', async () => {
      await p.goto(chat('601123456789'));
      await p.getByTestId('safety-notice').waitFor();
      if ((await p.getByTestId('safety-notice').getAttribute('data-level')) !== 'high')
        throw new Error('ZIP lure is not High');
    });
    await run(suffix, p, 'chat-zip-download', async () => {
      await p.getByTestId('safety-file').click();
      await p.getByTestId('safety-download-dialog').waitFor();
      await p.waitForTimeout(400);
    });
    await p.keyboard.press('Escape');
    await run(suffix, p, 'chat-phishing', async () => {
      await p.goto(chat('60198887766'));
      await p.getByTestId('safety-notice').waitFor();
    });
    await run(suffix, p, 'chat-hacked', async () => {
      await p.goto(chat('60129001234'));
      const bar = p.getByTestId('safety-chat-bar');
      await bar.waitFor();
      if ((await bar.getAttribute('data-kind')) !== 'hacked') throw new Error('no hacked bar');
    });
    await run(suffix, p, 'chat-macro', async () => {
      await p.goto(chat('60128814455'));
      await p.getByTestId('safety-notice').waitFor();
    });

    // An agent: the High-risk file is locked; trying it is refused and recorded.
    const agent = await signIn(size, scheme, 'daniel');
    await run(suffix, agent.page, 'chat-zip-agent', async () => {
      await agent.page.goto(chat('601123456789'));
      const file = agent.page.getByTestId('safety-file');
      await file.waitFor();
      if ((await file.getAttribute('data-locked')) !== 'true')
        throw new Error('not locked for agent');
      await file.click();
      await agent.page.getByText('This file is locked').waitFor();
    });
    await agent.ctx.close();
    await admin.ctx.close();
  }

// Auto-block (once, desktop light): switch it on, a new number sends the ZIP lure, it is blocked;
// the same lure from a known customer is not blocked. Then switch it back off.
{
  const { ctx, page } = await signIn(sizes.desktop, 'light', 'aisyah');
  await run('desktop-light', page, 'auto-block', async () => {
    await page.goto('/admin/safety');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByTestId('safety-auto-block').click();
    await page.getByRole('tab', { name: 'Flagged' }).click();
    await page.getByTestId('simulate-zipLure').click();
    await page.getByText('was blocked automatically').waitFor();
    await page.getByTestId('simulate-hackedCustomer').click();
    await page.waitForTimeout(2500);
    await page.getByRole('tab', { name: 'Blocked' }).click();
    const blocked = page.getByTestId('safety-blocked');
    await blocked.waitFor();
    const text = await blocked.textContent();
    if (!text.includes('Auto-blocked')) throw new Error('no auto-blocked number');
    if (text.includes('Jason Lim')) throw new Error('known customer was blocked');
  });
  await run('desktop-light', page, 'chat-auto-blocked', async () => {
    const state = await (await page.request.get('/api/mock/safety')).json();
    const auto = state.blocked.find((b) => b.auto);
    await page.goto(`/chats/${encodeURIComponent(auto.chatJid)}`);
    const bar = page.getByTestId('safety-chat-bar');
    await bar.waitFor();
    if ((await bar.getAttribute('data-kind')) !== 'blocked') throw new Error('no blocked bar');
  });
  await page.request.put('/api/mock/safety/settings', {
    data: { autoBlock: false },
    headers: { origin: BASE },
  });
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'safety-results.json'), JSON.stringify({ passed, problems }, null, 2));
console.log(`${passed.length} shots, ${problems.length} problems`);
for (const p of problems) console.log(' -', p);

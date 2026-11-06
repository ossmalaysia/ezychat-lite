// Screenshots of the proposed Partner role (partner-role) in the running seeded mock (run.ts --fake-wa),
// desktop 1280 px and mobile 360 px (touch), light and dark: Members with the Partner role, the invite
// form, the partner page (filled with an ending share and a "from today on" share, empty, long list,
// Share a chat), the chat header Share dialog, and the partner's own screens (only shared chats, a
// shared chat, the history cut in a group, Group info with names only, "No longer shared", the account
// menu, a partner with no chats). The mock state is on the server, so run it on a fresh mock.
// Reports page errors and horizontal overflow; ends with screenshots/results.json.
// Usage: node docs/features/partner-role/mock/partner-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const passed = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
const chat = (jid) => `/chats/${encodeURIComponent(jid)}`;
const PRIYA = '60128814455@s.whatsapp.net';
const FARAH = '60123110021@s.whatsapp.net';
const KOPI = '120363025550002@g.us';
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

for (const scheme of schemes)
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    const open = async (username) => {
      const ctx = await browser.newContext({
        ...size,
        baseURL: BASE,
        colorScheme: scheme,
        timezoneId: 'Asia/Kuala_Lumpur',
      });
      const login = await ctx.request.post('/api/auth/login', {
        data: { username, password: 'demo-pass-123' },
        headers: { origin: BASE },
      });
      if (!login.ok()) throw new Error(`login ${username} failed ${login.status()}`);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${suffix} ${username} pageerror: ${e.message}`));
      return { ctx, page };
    };
    let page;
    const shot = async (name, full = false) => {
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
      await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`), fullPage: full });
      passed.push(`${name}-${suffix}`);
    };
    const step = async (name, run) => {
      try {
        await run();
      } catch (e) {
        problems.push(`${suffix} ${name}: ${e.message.split('\n')[0]}`);
        await page.keyboard.press('Escape').catch(() => {});
      }
    };
    const dialog = () => page.getByRole('dialog');

    // ---- Admin (Aisyah) ----
    const admin = await open('aisyah');
    page = admin.page;
    await step('members', async () => {
      await page.goto('/admin/members');
      await page.locator('text=Ravi Kumar >> visible=true').first().waitFor();
      await shot('01-members', true);
    });
    await step('invite', async () => {
      await page.getByRole('button', { name: 'Add member' }).click();
      await dialog().waitFor();
      await dialog().getByLabel('Role').click();
      await page.getByRole('option', { name: 'Partner' }).click();
      await dialog().getByLabel('Partner company (optional)').fill('CallPro Services');
      await shot('02-invite-partner');
      await page.keyboard.press('Escape');
    });
    await step('partner page', async () => {
      await page.locator('a:has-text("Ravi Kumar") >> visible=true').first().click();
      await page.getByTestId('shared-chats').waitFor();
      await shot('03-partner-page', true);
    });
    await step('add chat', async () => {
      await page.getByRole('button', { name: 'Share a chat' }).click();
      await page.getByTestId('add-chat-dialog').waitFor();
      await page
        .getByTestId('add-chat-dialog')
        .getByRole('button', { name: /Farah/ })
        .first()
        .click();
      await shot('04-add-chat-dialog');
      await page.keyboard.press('Escape');
    });
    await step('long list', async () => {
      await page.getByRole('button', { name: /Show a long list/ }).click();
      await page.getByRole('button', { name: /Show \d+ more/ }).waitFor();
      await shot('05-partner-long-list', true);
      await page.getByRole('button', { name: 'Back to the real list' }).click();
      await page.getByRole('button', { name: /Show \d+ more/ }).waitFor({ state: 'detached' });
    });
    await step('partner empty', async () => {
      await page.goto('/admin/members');
      await page.locator('a:has-text("Sofia Tan") >> visible=true').first().click();
      await page.getByText('No chats shared yet').waitFor();
      await shot('06-partner-empty', true);
    });
    await step('chat share dialog', async () => {
      await page.goto(chat(PRIYA));
      await page.getByTestId('share-with-partner').click();
      await page.getByTestId('share-dialog').waitFor();
      await shot('07-chat-share-dialog');
      await page.keyboard.press('Escape');
    });
    await step('chat share new', async () => {
      await page.goto(chat(FARAH));
      await page.getByTestId('share-with-partner').click();
      await page.getByTestId('share-dialog').waitFor();
      await page.getByLabel('Only messages from today on').click();
      await page.getByLabel('Stop sharing', { exact: true }).click();
      await page.getByRole('option', { name: 'After 30 days' }).click();
      await shot('08-chat-share-new');
      await page.keyboard.press('Escape');
    });
    await admin.ctx.close();

    // ---- Partner (Ravi) ----
    const ravi = await open('ravi');
    page = ravi.page;
    await step('partner list', async () => {
      await page.goto('/');
      await page.getByTestId('partner-banner').waitFor();
      await shot('09-partner-list');
    });
    await step('partner chat', async () => {
      await page.goto(chat(PRIYA));
      await page.locator('text=My order #1042 >> visible=true').first().waitFor();
      await shot('10-partner-chat');
    });
    await step('partner group', async () => {
      await page.goto(chat(KOPI));
      await page.getByTestId('history-cut').waitFor();
      await shot('11-partner-group-history');
      await page.getByRole('button', { name: /Open group info/ }).click();
      await page.getByText('Nurul Huda').last().waitFor();
      await shot('12-partner-group-info');
      await page
        .getByRole('button', { name: /Farah Aziz/ })
        .first()
        .click();
      await page.getByTestId('partner-names-only').waitFor();
      await shot('13-partner-group-member');
    });
    await step('not shared', async () => {
      await page.goto(chat(FARAH));
      await page.getByRole('heading', { name: 'No longer shared' }).waitFor();
      await shot('14-partner-not-shared');
    });
    await step('menu', async () => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByText('Partner · BrightDesk Outsourcing').waitFor();
      await shot('15-partner-menu');
      await page.keyboard.press('Escape');
    });
    await ravi.ctx.close();

    // ---- Partner with no chats (Sofia) ----
    const sofia = await open('sofia');
    page = sofia.page;
    await step('partner none', async () => {
      await page.goto('/');
      await page.getByText('No chats shared with you yet').waitFor();
      await shot('16-partner-no-chats');
    });
    await sofia.ctx.close();
  }

await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ passed, problems }, null, 2));
console.log(`${passed.length} screenshots, ${problems.length} problems`);
for (const p of problems) console.log(' -', p);
process.exitCode = problems.length ? 1 : 0;

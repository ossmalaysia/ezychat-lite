// Screenshots of the proposed Ask Ezy panel in the running seeded mock (run.ts --fake-wa), at desktop 1280 px
// and mobile 360 px (touch), light and dark: the entry buttons (inbox, chat header, admin), the empty panel
// (admin, team member, no AI connection), each of the 7 answer blocks (number cards, bar chart, busy hours,
// chat list, customer summary, change cards with their tests, test result), Apply all with Undo, an Apply
// conflict, live steps while Ezy works, Stop, and the errors (provider, timeout, expired sign-in). Reports page
// errors and horizontal overflow; ends with ask-ezy-results.json.
// Usage: node docs/features/ask-ezy/mock/ask-ezy-shots.mjs [baseUrl] [--only=light|dark] [--size=desktop|mobile]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) ?? 'http://localhost:7489';
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const onlySize = args.find((a) => a.startsWith('--size='))?.slice(7);
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM
    ? { executablePath: process.env.PW_CHROMIUM }
    : { channel: process.env.PW_CHANNEL ?? 'chrome' },
);
const problems = [];
const passed = [];
const send = (ctx, path, data, method = 'post') =>
  ctx.request[method](path, { data, headers: { origin: BASE } });

const FARAH = '60123110021@s.whatsapp.net';
const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};

async function session(user, scheme, sizeName) {
  const ctx = await browser.newContext({
    ...sizes[sizeName],
    baseURL: BASE,
    colorScheme: scheme,
    timezoneId: 'Asia/Kuala_Lumpur',
  });
  const login = await send(ctx, '/api/auth/login', { username: user, password: 'demo-pass-123' });
  if (!login.ok()) throw new Error(`login ${user} failed ${login.status()}`);
  const page = await ctx.newPage();
  const suffix = `${sizeName}-${scheme}`;
  page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
  const shot = async (name) => {
    await page.waitForTimeout(450);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
    await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`) });
    passed.push(`${name}-${suffix}`);
  };
  const step = async (name, run) => {
    try {
      await run();
    } catch (e) {
      problems.push(`${suffix} ${name}: ${e.message.split('\n')[0]}`);
    }
  };
  return { ctx, page, shot, step };
}

const panel = (page) => page.getByTestId('ask-ezy-panel');
const visibleOpen = (page) => page.locator('[data-testid="ask-ezy-open"]:visible').first();
async function openPanel(page) {
  await visibleOpen(page).click();
  await panel(page).waitFor();
}
async function type(page, question) {
  const box = panel(page).getByRole('textbox');
  await box.fill(question);
  await box.press('Enter');
}
async function ask(page, question) {
  await type(page, question);
  await panel(page).getByTestId('ask-ezy-thinking').waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForTimeout(500);
}
async function newConversation(page) {
  const btn = panel(page).getByRole('button', { name: /start over/i });
  if (!(await btn.count())) return;
  await btn.click();
  // The panel asks first when the conversation has change cards.
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Start over' });
  await confirm
    .waitFor({ timeout: 1000 })
    .then(() => confirm.click())
    .catch(() => {});
}
/** Scrolls the panel so the given block is at the top, for the screenshot. */
async function showBlock(page, testId) {
  await panel(page)
    .getByTestId(testId)
    .last()
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
}
const mockState = (ctx, body) => send(ctx, '/api/mock/ask-ezy/state', body, 'put');

for (const scheme of only ? [only] : ['light', 'dark'])
  for (const sizeName of onlySize ? [onlySize] : Object.keys(sizes)) {
    // Admin
    {
      const { ctx, page, shot, step } = await session('aisyah', scheme, sizeName);
      await mockState(ctx, { mode: 'normal', applyConflict: false });
      for (const id of ['rule-delivery', 'kb-delivery'])
        await send(ctx, `/api/mock/ask-ezy/changes/${id}/undo`, {});
      await page.goto('/');
      await page.getByRole('heading', { level: 1 }).waitFor();
      await step('entry', async () => shot('00-entry-button'));
      await step('empty', async () => {
        await openPanel(page);
        await shot('01-empty-admin');
      });
      await step('stats', async () => {
        await ask(page, 'How is my inbox this week?');
        await shot('02-number-cards');
      });
      await step('bars', async () => {
        await ask(page, 'Why does the AI hand off chats?');
        await shot('03-bar-chart');
      });
      await step('heatmap', async () => {
        await ask(page, 'When do new customers write?');
        await shot('04-busy-hours');
      });
      await step('chats', async () => {
        await ask(page, 'Which customers wait for a reply?');
        await shot('05-chat-list');
      });
      await step('change', async () => {
        await newConversation(page);
        await ask(page, 'Fix my knowledge and hand-off rules');
        await shot('06-change-cards');
        await showBlock(page, 'ask-block-change-rule-delivery');
        await shot('07-change-with-test');
        await panel(page).getByTestId('ask-ezy-apply-all').click();
        await panel(page)
          .getByTestId('ask-block-change-rule-delivery')
          .getByText(/Undo stays here/)
          .waitFor();
        await showBlock(page, 'ask-block-change-kb-delivery');
        await shot('08-applied-undo');
      });
      await step('new conversation confirm', async () => {
        await panel(page)
          .getByRole('button', { name: /start over/i })
          .click();
        await page.getByRole('alertdialog').waitFor();
        await shot('22-new-conversation-confirm');
        await page.getByRole('button', { name: 'Keep this conversation' }).click();
      });
      await step('test block', async () => {
        await ask(page, 'Test the delivery change');
        await shot('09-test-result');
      });
      await step('conflict', async () => {
        for (const id of ['rule-delivery', 'kb-delivery'])
          await send(ctx, `/api/mock/ask-ezy/changes/${id}/undo`, {});
        await mockState(ctx, { applyConflict: true });
        await newConversation(page);
        await ask(page, 'Fix my knowledge and hand-off rules');
        await panel(page)
          .getByTestId('ask-block-change-kb-delivery')
          .getByRole('button', { name: 'Apply', exact: true })
          .click();
        await panel(page)
          .getByTestId('ask-block-change-kb-delivery')
          .getByText(/Not applied/)
          .waitFor();
        await page.waitForTimeout(700);
        await shot('10-apply-conflict');
        await mockState(ctx, { applyConflict: false });
      });
      await step('chat entry', async () => {
        await page.keyboard.press('Escape');
        await page.goto(`/chats/${encodeURIComponent(FARAH)}`);
        await page.getByTestId('ask-ezy-about-chat').waitFor();
        await shot('11-chat-entry');
      });
      await step('about chat', async () => {
        await page.getByTestId('ask-ezy-about-chat').click();
        await panel(page).getByTestId('ask-block-customer').waitFor({ timeout: 20000 });
        await page.waitForTimeout(500);
        await shot('12-customer-summary');
      });
      await step('thinking', async () => {
        await mockState(ctx, { mode: 'slow' });
        await newConversation(page);
        await type(page, 'Fix my knowledge and hand-off rules');
        await panel(page)
          .getByText(/^Read hand-offs/)
          .waitFor({ timeout: 10000 });
        await page.waitForTimeout(1700);
        await shot('13-thinking-steps');
        await panel(page).getByRole('button', { name: 'Stop' }).click();
        await panel(page).getByTestId('ask-ezy-stopped').waitFor();
        await shot('14-stopped');
      });
      for (const [mode, name] of [
        ['error', '15-error-provider'],
        ['timeout', '16-error-timeout'],
        ['expired', '17-error-expired'],
      ])
        await step(name, async () => {
          await mockState(ctx, { mode });
          await newConversation(page);
          await ask(page, 'Which customers wait for a reply?');
          await panel(page).getByTestId('ask-ezy-error').last().waitFor();
          await shot(name);
        });
      await step('no connection', async () => {
        await mockState(ctx, { mode: 'no_connection' });
        await page.keyboard.press('Escape');
        await page.goto('/');
        await openPanel(page);
        await newConversation(page);
        await panel(page).getByText('Connect an AI to use Ask Ezy').waitFor();
        await shot('18-no-connection-admin');
        await mockState(ctx, { mode: 'normal' });
      });
      await step('admin entry', async () => {
        await page.keyboard.press('Escape');
        await page.goto('/admin/settings');
        await visibleOpen(page).waitFor();
        await shot('19-admin-entry');
      });
      await ctx.close();
    }
    // Team member
    {
      const { ctx, page, shot, step } = await session('daniel', scheme, sizeName);
      await page.goto('/');
      await page.getByRole('heading', { level: 1 }).waitFor();
      await step('member empty', async () => {
        await openPanel(page);
        await shot('20-empty-member');
      });
      await step('member change', async () => {
        await ask(page, 'Fix my knowledge and hand-off rules');
        await shot('21-member-no-changes');
      });
      await ctx.close();
    }
  }

await browser.close();
writeFileSync(join(OUT, 'ask-ezy-results.json'), JSON.stringify({ passed, problems }, null, 2));
console.log(`passed ${passed.length}, problems ${problems.length}`);
for (const p of problems) console.log(' -', p);

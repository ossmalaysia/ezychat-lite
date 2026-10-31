// Screenshots of the proposed "Answer direct chats" switch (ai-direct-chats) in the running seeded
// mock (run.ts --fake-wa), at desktop 1280 px and mobile 360 px (touch), light and dark: the agent
// page Direct chats card (on; off with Answer in groups on = group-only; off with groups off = answers
// nothing; the confirm dialog when the agent holds open direct chats) and the assignee list of a
// direct chat without the AI agent. Reports page errors and horizontal overflow; ends with
// direct-results.json.
// Usage: node docs/features/ai-direct-chats/mock/direct-shots.mjs [baseUrl]
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
const send = (ctx, path, data, method = 'post') =>
  ctx.request[method](path, { data, headers: { origin: BASE } });

const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};

for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    const ctx = await browser.newContext({
      ...size,
      baseURL: BASE,
      colorScheme: scheme,
      timezoneId: 'Asia/Kuala_Lumpur',
    });
    const login = await send(ctx, '/api/auth/login', {
      username: 'aisyah',
      password: 'demo-pass-123',
    });
    if (!login.ok()) throw new Error(`login failed ${login.status()}`);
    const setGroups = (enabled) => send(ctx, '/api/mock/groups/agents/a1', { enabled }, 'put');
    const setDirect = (enabled) =>
      send(ctx, '/api/mock/groups/agents/a1/direct', { enabled }, 'put');
    await send(ctx, '/api/mock/groups/scenario', { reset: true }, 'put');

    // The AI member must be on to hold a chat (an earlier run may have left it off).
    const status = await (await ctx.request.get('/api/ai')).json();
    if (status.settings) await send(ctx, '/api/ai', { ...status.settings, enabled: true }, 'put');
    // An open direct chat held by the AI member, for the confirm dialog.
    const users = await (await ctx.request.get('/api/users')).json();
    const ai = (users.users ?? users).find((u) => u.kind === 'ai');
    const chats = await (await ctx.request.get('/api/chats')).json();
    const dm = (chats.chats ?? chats.items ?? chats).find(
      (c) => c.type === 'dm' && c.status === 'open',
    );
    if (ai && dm)
      await send(ctx, `/api/chats/${encodeURIComponent(dm.jid)}`, { assignedTo: ai.id }, 'patch');
    else problems.push(`${suffix}: no AI user or open direct chat to assign`);

    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const overflow = async (name) => {
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        )
      )
        problems.push(`${suffix} ${name}: horizontal overflow`);
    };
    const element = async (name, locator) => {
      await page.waitForTimeout(400);
      await overflow(name);
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: join(OUT, `${name}-${suffix}.png`) });
      passed.push(`${name}-${suffix}`);
    };
    const step = async (name, run) => {
      try {
        await run();
      } catch (e) {
        problems.push(`${suffix} ${name}: ${e.message.split('\n')[0]}`);
      }
    };
    const agentPage = async () => {
      await page.goto('/admin/members/ai/a1?edition=enterprise');
      await page.getByTestId('agent-direct').waitFor();
    };
    const cards = () => page.getByTestId('agent-direct');

    await step('on', async () => {
      await agentPage();
      await element('01-direct-on', cards());
    });
    await step('confirm', async () => {
      // The AI may hand a just-assigned chat back at once: assign again right before the click.
      if (ai && dm)
        await send(ctx, `/api/chats/${encodeURIComponent(dm.jid)}`, { assignedTo: ai.id }, 'patch');
      const view = await (await ctx.request.get('/api/mock/groups')).json();
      if (!view.heldDirect) throw new Error('the AI holds no direct chat');
      await agentPage();
      await page.getByTestId('answer-direct').click();
      const dialog = page.getByRole('alertdialog');
      await dialog.waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `02-direct-confirm-${suffix}.png`) });
      passed.push(`02-direct-confirm-${suffix}`);
      await dialog.getByRole('button', { name: /turn off/i }).click();
      await dialog.waitFor({ state: 'hidden' });
    });
    await step('group-only', async () => {
      await setGroups(true);
      await agentPage();
      await page.getByTestId('direct-group-only').waitFor();
      await element('03-direct-off-group-only', cards());
      await page.screenshot({
        path: join(OUT, `04-agent-page-group-only-${suffix}.png`),
        fullPage: true,
      });
      passed.push(`04-agent-page-group-only-${suffix}`);
    });
    await step('nothing', async () => {
      await setGroups(false);
      await agentPage();
      await page.getByTestId('direct-none').waitFor();
      await element('05-direct-off-answers-nothing', cards());
    });
    await step('assignee', async () => {
      if (!dm) return;
      await page.goto(`/chats/${encodeURIComponent(dm.jid)}?edition=enterprise`);
      const trigger = page.locator('header').getByRole('combobox').first();
      await trigger.waitFor();
      await trigger.click();
      const list = page.getByRole('listbox');
      await list.waitFor();
      if (await list.getByText(/\(AI\)|AI/).count())
        problems.push(`${suffix} assignee: AI agent still listed`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `06-assignee-no-ai-${suffix}.png`) });
      passed.push(`06-assignee-no-ai-${suffix}`);
      await page.keyboard.press('Escape');
    });
    await setDirect(true);
    await ctx.close();
  }

await browser.close();
writeFileSync(join(OUT, 'direct-results.json'), JSON.stringify({ passed, problems }, null, 2));
console.log(JSON.stringify({ passed: passed.length, problems }, null, 2));

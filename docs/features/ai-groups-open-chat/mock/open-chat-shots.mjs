// Screenshots of the proposed group settings (ai-groups-open-chat) in the running seeded mock
// (run.ts --fake-wa), at desktop 1280 px and mobile 360 px (touch), light and dark: the agent page
// Groups card (all groups with the per-group choices, selected groups only, Open chat as the default
// with the cost line, the choice list open), the Kopi Lovers Club in Open chat (tag, quote, follow-up
// without a tag, open question answered, a question for a member and members chatting not answered,
// the polite line on a tagged election question, hand-over), the header badges, Group info (admin
// choice, agent view) and the chat's Mock only panel (an open question in Open chat and in Tag and
// quote, a question for a person, politics with and without a tag). Reports page errors and horizontal
// overflow; ends with open-chat-results.json.
// Usage: node docs/features/ai-groups-open-chat/mock/open-chat-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
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

const CLUB = '120363025550002@g.us';
const RESELLERS = '120363025550003@g.us';
const chatUrl = (jid) => `/chats/${encodeURIComponent(jid)}?edition=enterprise`;

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
    const scenario = (body) => send(ctx, '/api/mock/groups/scenario', body, 'put');
    const setAgent = (body) => send(ctx, '/api/mock/groups/agents/a1', body, 'put');
    await scenario({ reset: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const overflow = async (name) => {
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (wide) problems.push(`${suffix} ${name}: horizontal overflow`);
    };
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(400);
      await overflow(name);
      await page.screenshot({ path: join(OUT, `oc-${name}-${suffix}.png`), ...opts });
      passed.push(`${name}-${suffix}`);
    };
    const element = async (name, locator) => {
      await page.waitForTimeout(300);
      await overflow(name);
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: join(OUT, `oc-${name}-${suffix}.png`) });
      passed.push(`${name}-${suffix}`);
    };
    const step = async (name, run) => {
      try {
        await run();
      } catch (error) {
        problems.push(`${suffix} ${name}: ${error.message.split('\n')[0]}`);
      }
    };
    const agentPage = async () => {
      await page.goto('/admin/members/ai/a1?edition=enterprise');
      await page.getByTestId('agent-groups').waitFor();
      await page.waitForTimeout(300);
    };
    const chat = async (jid) => {
      await page.goto(chatUrl(jid));
      await page
        .getByRole('button', { name: /Open group info/ })
        .first()
        .waitFor();
      await page.waitForTimeout(500);
    };
    const card = () => page.getByTestId('agent-groups');

    // 1. Agent page → Groups: all groups (seed), the choice list open, selected only, Open chat.
    await step('agent-card', async () => {
      await agentPage();
      await element('01-card-all-groups', card());
      await card().getByTestId('group-setting').first().click();
      await page.getByRole('listbox').waitFor();
      await shot('02-group-choice-open');
      await page.keyboard.press('Escape');
      await setAgent({ scope: 'selected' });
      await agentPage();
      await element('03-card-selected-only', card());
      await setAgent({ scope: 'all', mode: 'open' });
      await agentPage();
      await card().getByTestId('open-chat-cost').waitFor();
      await element('04-card-open-chat-default', card());
      await scenario({ reset: true });
    });

    // 2. Kopi Lovers Club in Open chat: the seeded conversation, top to bottom.
    await step('club', async () => {
      await chat(CLUB);
      await page.getByTestId('group-ai-badge').waitFor();
      await page.getByText('ok, and on public holidays also open?').last().scrollIntoViewIfNeeded();
      await shot('05-club-follow-up-no-tag');
      await page.getByText('Siti, are you coming to the meet-up').last().scrollIntoViewIfNeeded();
      await shot('06-club-open-question-and-person');
      await page.getByText('who do you all think will win').last().scrollIntoViewIfNeeded();
      await shot('07-club-sensitive-and-handover');
      await chat(RESELLERS);
      await shot('08-resellers-tag-and-quote');
    });

    // 3. Group info: the admin's choice and the agent's read-only view.
    await step('group-info', async () => {
      await chat(CLUB);
      await page
        .getByRole('button', { name: /Open group info/ })
        .first()
        .click();
      await page.getByTestId('group-ai-row').waitFor();
      await shot('09-group-info-admin');
      await page.getByTestId('group-ai-setting').click();
      await page.getByRole('listbox').waitFor();
      await shot('10-group-info-choices');
      await page.keyboard.press('Escape');
      await scenario({ viewAs: 'agent' });
      await chat(CLUB);
      await page
        .getByRole('button', { name: /Open group info/ })
        .first()
        .click();
      await page.getByTestId('group-ai-state').waitFor();
      await shot('11-group-info-agent-view');
      await scenario({ viewAs: 'admin' });
    });

    // 4. Simulations: open question in Open chat (answered) and in Tag and quote (silent), a
    // question for a person (silent), politics without a tag (silent) and with a tag (polite line).
    await step('simulate', async () => {
      const run = async (jid, kind, outcome, name) => {
        await chat(jid);
        await page.getByTestId('mock-groups').locator('summary').click();
        await page.getByTestId(`simulate-${kind}`).click();
        await page.getByText(outcome).first().waitFor();
        await shot(name);
      };
      await run(CLUB, 'open', 'The AI answered in the group.', '12-sim-open-question-open-chat');
      await run(RESELLERS, 'open', 'nothing was sent', '13-sim-open-question-tag-mode');
      await run(CLUB, 'person', 'nothing was sent', '14-sim-question-for-a-person');
      await run(CLUB, 'sensitive', 'nothing was sent', '15-sim-politics-no-tag');
      await run(CLUB, 'sensitiveTagged', 'one polite line', '16-sim-politics-tagged');
    });

    // 5. The Groups card in Malay and Chinese.
    if (sizeName === 'desktop' && scheme === 'light')
      await step('languages', async () => {
        for (const lang of ['ms', 'zh-CN']) {
          await send(ctx, '/api/me', { locale: lang }, 'patch');
          await page.evaluate((l) => localStorage.setItem('wati.locale', l), lang);
          await agentPage();
          await element(`17-card-${lang}`, card());
        }
        await send(ctx, '/api/me', { locale: 'en' }, 'patch');
        await page.evaluate(() => localStorage.setItem('wati.locale', 'en'));
      });
    await scenario({ reset: true });
    await ctx.close();
  }
await browser.close();
writeFileSync(
  join(OUT, 'open-chat-results.json'),
  JSON.stringify({ ranAt: new Date().toISOString(), passed, failed: problems }, null, 2) + '\n',
);
console.log(
  `${passed.length} shots. ` +
    (problems.length ? problems.join('\n') : 'No page errors or horizontal overflow.'),
);

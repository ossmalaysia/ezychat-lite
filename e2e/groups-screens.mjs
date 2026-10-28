// Screenshots of AI agents in WhatsApp groups in the real app, against e2e/agents-devbuild.ts (mock
// model, fake WhatsApp) after e2e/devbuild-groups-check.mjs has run there (its admin, agent, group and
// group lines). Desktop 1280 px and mobile 360 px, light and dark: the agent page Groups card, the
// group chat (badge, quoted answers, lines, hand-over, paused), Group info and Try it with Group
// question. Reports page errors and horizontal overflow. Never calls a model.
// Usage: node e2e/groups-screens.mjs <port> <outDir>
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, join } from 'node:path';

const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
const GROUP = '120363099990001@g.us';
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'groups-screens');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
mkdirSync(OUT, { recursive: true });

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
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
      locale: 'en-US',
      timezoneId: 'Asia/Kuala_Lumpur',
    });
    const req = (method, path, data) =>
      ctx.request.fetch(path, { method, data, headers: { origin: BASE } });
    await req('POST', '/api/auth/login', { username: 'checker', password: 'check-pass-123' });
    const agent = (await (await req('GET', '/api/ai')).json()).agents[0];
    // The check left the group switched off; switch it on for the screens.
    await req('PUT', `/api/chats/${encodeURIComponent(GROUP)}/ai-group`, { enabled: true });

    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
      await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`), ...opts });
    };

    await page.goto(`/admin/members/ai/${agent.id}`);
    const card = page.getByTestId('agent-groups');
    await card.scrollIntoViewIfNeeded();
    await shot('01-agent-groups-card');
    await card.screenshot({ path: join(OUT, `01b-groups-card-only-${suffix}.png`) });

    await page.goto(`/chats/${encodeURIComponent(GROUP)}`);
    await page.getByTestId('group-ai-badge').first().waitFor();
    await shot('02-group-chat-bottom');
    await page.getByText('what time does the kitchen close?').first().scrollIntoViewIfNeeded();
    await shot('03-group-chat-tag-and-quote');

    await page.getByRole('button', { name: /Open group info for/ }).click();
    await page.getByTestId('group-ai-row').waitFor();
    await shot('04-group-info');

    await page.goto(`/admin/members/ai/${agent.id}`);
    await page.getByText('Group question').first().click();
    await page
      .getByLabel('Customer question', { exact: true })
      .fill('What time does the kitchen close?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.getByText('Nothing is sent to the group.').first().waitFor({ timeout: 15_000 });
    await page.getByText('Nothing is sent to the group.').first().scrollIntoViewIfNeeded();
    await shot('05-try-group-question');
    await ctx.close();
  }

await browser.close();
console.log(problems.length ? problems.join('\n') : 'no page errors or horizontal overflow');
console.log(`screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);

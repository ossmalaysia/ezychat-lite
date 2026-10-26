// Screenshots of Admin → Connectors and the Google Calendar connector in the real app, against
// e2e/agents-devbuild.ts (mock model, fake WhatsApp, fake Google) after e2e/devbuild-calendar-check.mjs
// has run there (its admin, agent, bookings and activity). Desktop 1280 px and mobile 360 px, light and
// dark; reports page errors and horizontal overflow. Never calls Google or a model.
// Usage: node e2e/connectors-screens.mjs <port> <outDir>
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, join } from 'node:path';

const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
/** Only this local Dev Build: links the server hands back must point at it. */
const local = (link) => {
  const url = new URL(link, BASE);
  if (url.origin !== BASE) throw new Error('Refusing a link outside the local Dev Build');
  return url.href;
};
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'connectors-screens');
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
    const fakeState = (state) => req('POST', '/api/dev/fake-google-calendar', { state });
    const connect = async () => {
      if (
        (await (await req('GET', '/api/connectors/google-calendar')).json()).state !==
        'disconnected'
      )
        return;
      const start = await (await req('POST', '/api/connectors/google-calendar/connect')).json();
      const consent = await (await ctx.request.get(local(start.authorizationUrl))).text();
      const allow = /id="allow" href="([^"]+)"/.exec(consent)[1].replaceAll('&#38;', '&');
      await ctx.request.get(local(allow));
    };
    await connect();
    await fakeState('ok');

    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
      await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`), ...opts });
    };
    const gc = async (tab = 'overview') => {
      await page.goto(`/admin/connectors/google-calendar?tab=${tab}`);
      await page.getByTestId('connector-page-google-calendar').waitFor();
    };

    await page.goto('/admin/connectors');
    await page.getByTestId('connectors-gallery').waitFor();
    await shot('01-gallery', { fullPage: true });
    await page.getByRole('searchbox', { name: 'Search connectors' }).fill('zzz');
    await shot('02-gallery-no-match');
    await gc();
    await shot('03-gc-overview', { fullPage: true });
    await gc('settings');
    await page.getByTestId('agent-bookings').waitFor();
    await shot('04-gc-settings', { fullPage: true });
    await gc('activity');
    await page.getByTestId('calendar-activity').waitFor();
    await shot('05-gc-activity');
    await fakeState('expired');
    await gc();
    await shot('06-gc-expired', { fullPage: true });
    await page.goto('/admin/connectors');
    await page.getByTestId('connectors-gallery').waitFor();
    await shot('07-gallery-attention');
    await fakeState('ok');
    await page.goto('/admin/connectors/autocount');
    await page.getByTestId('connector-page-autocount').waitFor();
    await shot('08-coming-soon', { fullPage: true });
    await page.goto('/admin/connectors/custom-mcp');
    await page.getByTestId('connector-page-custom-mcp').waitFor();
    await shot('09-enterprise-only', { fullPage: true });

    await page.goto(`/admin/members/ai/${agent.id}`);
    const card = page.getByTestId('agent-connectors');
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await shot('10-agent-connectors');

    // Try it: the mock model checks free times for BOOK.
    const question = page.getByLabel('Customer question', { exact: true });
    await question.fill('Can I BOOK a table?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.getByText('AI checked free times').first().waitFor({ timeout: 15_000 });
    await question.scrollIntoViewIfNeeded();
    await shot('11-try-free-times');

    // The chat the check booked: "AI checked free times" and "AI booked …".
    const chats = (await (await req('GET', '/api/chats')).json()).chats ?? [];
    for (const chat of chats) {
      const detail = await (await req('GET', `/api/chats/${encodeURIComponent(chat.jid)}`)).json();
      if (
        !detail.events?.some(
          (e) => e.type === 'ai_tool_used' && e.payload?.calendar?.action === 'booked',
        )
      )
        continue;
      await page.goto(`/chats/${encodeURIComponent(chat.jid)}`);
      await page
        .getByText(/AI booked/)
        .first()
        .waitFor();
      await shot('12-chat-booked');
      break;
    }

    // Not connected (last: Disconnect from the page, confirmed).
    await gc();
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('button', { name: 'Connect Google Calendar' }).waitFor();
    await shot('13-gc-not-connected', { fullPage: true });
    await gc('settings');
    await shot('14-gc-settings-not-connected');
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? problems.join('\n') : 'No page errors or horizontal overflow.');

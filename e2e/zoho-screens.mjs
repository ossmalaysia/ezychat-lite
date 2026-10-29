// Screenshots of the Zoho CRM connector in the real app, against e2e/agents-devbuild.ts (mock model,
// fake WhatsApp, fake Zoho) after e2e/devbuild-zoho-check.mjs has run there (its admin, agent, lead
// chat and activity). Desktop 1280 px and mobile 360 px, light and dark: gallery, Overview (connected,
// expired, unavailable, not connected with the Zoho site choice), Settings (Add new leads on/off), Activity,
// agent page row, the customer panel (lead by the AI, not in Zoho CRM) and the chat lines. Reports page
// errors and horizontal overflow. Never calls Zoho or a model.
// Usage: node e2e/zoho-screens.mjs <port> <outDir>
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
const OUT = resolve(repo, process.argv[3] ?? 'zoho-screens');
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
    const fakeState = (state) => req('POST', '/api/dev/fake-zoho', { state });
    const connect = async () => {
      if ((await (await req('GET', '/api/connectors/zoho-crm')).json()).state !== 'disconnected')
        return;
      const start = await (
        await req('POST', '/api/connectors/zoho-crm/connect', { region: 'com' })
      ).json();
      const consent = await (await ctx.request.get(local(start.authorizationUrl))).text();
      const accept = /id="accept" href="([^"]+)"/.exec(consent)[1].replaceAll('&#38;', '&');
      await ctx.request.get(local(accept));
    };
    await connect();
    await fakeState('ok');
    const settings = (addLeads) =>
      req('PUT', `/api/connectors/zoho-crm/agents/${agent.id}`, {
        find: true,
        addLeads,
        ownerId: null,
        leadSource: 'WhatsApp',
        includeRequest: true,
      });
    await settings(true);

    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
      await page.screenshot({ path: join(OUT, `zoho-${name}-${suffix}.png`), ...opts });
    };
    const zohoPage = async (tab = 'overview') => {
      await page.goto(`/admin/connectors/zoho-crm?tab=${tab}`);
      await page.getByTestId('connector-page-zoho-crm').waitFor();
      await page.waitForTimeout(500);
    };
    const panel = async (jid) => {
      await page.goto(`/chats/${encodeURIComponent(jid)}`);
      await page.getByRole('button', { name: /Open customer details/ }).click();
      await page.getByTestId('customer-zoho-crm').waitFor();
    };
    const chats = (await (await req('GET', '/api/chats?limit=50')).json()).chats ?? [];
    const leadChat = chats.find((c) => c.jid.startsWith('6013') && c.name !== 'Ali');

    await page.goto('/admin/connectors');
    await page.getByTestId('connector-card-zoho-crm').waitFor();
    await shot('01-gallery', { fullPage: true });
    await zohoPage();
    await shot('02-overview', { fullPage: true });
    await zohoPage('settings');
    await shot('03-settings-add-leads', { fullPage: true });
    await settings(false);
    await zohoPage('settings');
    await shot('04-settings-find-only', { fullPage: true });
    await zohoPage('activity');
    await shot('05-activity', { fullPage: true });
    await fakeState('expired');
    await zohoPage();
    await page.getByTestId('zoho-crm-account').scrollIntoViewIfNeeded();
    await shot('06-expired');
    await fakeState('ok');
    await fakeState('unavailable');
    await zohoPage();
    await page.getByTestId('zoho-crm-account').scrollIntoViewIfNeeded();
    await shot('08-unavailable');
    await fakeState('ok');
    await page.goto(`/admin/members/ai/${agent.id}`);
    await page.getByTestId('agent-connector-zoho-crm').scrollIntoViewIfNeeded();
    await shot('14-agent-connectors');
    if (leadChat) {
      await page.goto(`/chats/${encodeURIComponent(leadChat.jid)}`);
      await page
        .getByText(/AI added a lead/)
        .first()
        .waitFor();
      await shot('15-chat-lead-added');
      await panel(leadChat.jid);
      await shot('16-panel-lead-by-ai');
    } else problems.push(`${suffix}: no lead chat (run devbuild-zoho-check.mjs first)`);
    const ali = chats.find((c) => c.name === 'Ali');
    if (ali) {
      await panel(ali.jid);
      await shot('18-panel-not-in-crm');
    }
    await req('POST', '/api/connectors/zoho-crm/disconnect');
    await zohoPage();
    await shot('10-not-connected', { fullPage: true });
    await page.getByTestId('zoho-region').click();
    await shot('11-region-choice');
    await page.keyboard.press('Escape');
    await connect();
    await settings(true);
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? problems.join('\n') : 'No page errors or horizontal overflow.');

// Screenshots of the proposed built-in Zoho CRM connector (zoho-crm) in the running seeded mock
// (run.ts --fake-wa), at desktop 1280 px and mobile 360 px (touch), light and dark: the gallery
// (Zoho CRM connected, needs attention), the Zoho CRM page (Overview connected / expired /
// unavailable / not connected with the Zoho site choice, the stand-in Zoho sign-in), Settings
// (Add new leads on with owner, Lead Source and request summary; off; not connected), Activity, the
// agent page Connectors row, the customer panel (Contact, Lead added by the AI, not in Zoho CRM with
// Add as a lead, added), the lead chat with the two Zoho CRM lines, and the Lite view. Reports page
// errors and horizontal overflow.
// Usage: node docs/features/zoho-crm/mock/zoho-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const post = (ctx, path, data, method = 'post') =>
  ctx.request[method](path, { data, headers: { origin: BASE } });

const KAVITHA = '60132228899@s.whatsapp.net';
const FARAH = '60123110021@s.whatsapp.net';
const AHMAD = '60125550142@s.whatsapp.net';
const CRM = {
  find: true,
  addLeads: true,
  ownerId: 'default',
  leadSource: 'WhatsApp',
  includeRequest: true,
};
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
    const login = await post(ctx, '/api/auth/login', {
      username: 'aisyah',
      password: 'demo-pass-123',
    });
    if (!login.ok()) throw new Error(`login failed ${login.status()}`);
    const reset = async (state = 'connected', crm = CRM) => {
      await post(ctx, '/api/mock/zoho-crm/connect', { region: 'com' });
      await post(ctx, '/api/mock/zoho-crm/state', { state }, 'put');
      await post(ctx, '/api/mock/zoho-crm/agents/a1', crm, 'put');
    };
    await reset();
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
      await page.waitForTimeout(300);
    };
    const panel = async (jid) => {
      await page.goto(`/chats/${encodeURIComponent(jid)}`);
      await page.getByRole('button', { name: /Open customer details/ }).click();
      await page.getByTestId('customer-zoho-crm').waitFor();
    };

    // Gallery: Zoho CRM connected among "Your connectors".
    await page.goto('/admin/connectors');
    await page.getByTestId('connector-card-zoho-crm').waitFor();
    await shot('01-gallery', { fullPage: true });

    // Zoho CRM page.
    await zohoPage();
    await shot('02-overview', { fullPage: true });
    await zohoPage('settings');
    await shot('03-settings-add-leads', { fullPage: true });
    await reset('connected', { ...CRM, addLeads: false });
    await zohoPage('settings');
    await shot('04-settings-find-only', { fullPage: true });
    await zohoPage('activity');
    await shot('05-activity', { fullPage: true });
    await post(ctx, '/api/mock/zoho-crm/state', { state: 'expired' }, 'put');
    await zohoPage();
    await page.getByTestId('zoho-crm-account').scrollIntoViewIfNeeded();
    await shot('06-expired');
    await zohoPage('settings');
    await shot('07-settings-paused');
    await post(ctx, '/api/mock/zoho-crm/state', { state: 'unavailable' }, 'put');
    await zohoPage();
    await page.getByTestId('zoho-crm-account').scrollIntoViewIfNeeded();
    await shot('08-unavailable');
    await page.goto('/admin/connectors');
    await page.getByTestId('connector-card-zoho-crm').waitFor();
    await shot('09-gallery-attention', { fullPage: true });
    await post(ctx, '/api/mock/zoho-crm/disconnect', {});
    await zohoPage();
    await shot('10-not-connected', { fullPage: true });
    await page.getByTestId('zoho-region').click();
    await shot('11-region-choice');
    await page.getByRole('option', { name: 'zoho.eu (Europe)' }).click();
    await page.getByRole('button', { name: 'Connect Zoho CRM' }).click();
    await page.getByTestId('zoho-consent').waitFor();
    await shot('12-zoho-sign-in');
    await page.keyboard.press('Escape');
    await zohoPage('settings');
    await shot('13-settings-not-connected');
    await reset();

    // Agent page → Connectors row.
    await page.goto('/admin/members/ai/a1');
    const card = page.getByTestId('agent-connectors');
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await shot('14-agent-connectors');

    // The lead chat and the customer panel.
    await page.goto(`/chats/${encodeURIComponent(KAVITHA)}`);
    await page.getByText(/AI added a lead/).first().waitFor();
    await shot('15-chat-lead-added');
    await panel(KAVITHA);
    await shot('16-panel-lead-by-ai');
    await panel(FARAH);
    await shot('17-panel-contact');
    await panel(AHMAD);
    await shot('18-panel-not-in-crm');

    // Lite edition: the same connector (core).
    await page.goto('/admin/connectors/zoho-crm?edition=lite');
    await page.getByTestId('connector-page-zoho-crm').waitFor();
    await shot('19-lite-overview', { fullPage: true });
    await page.goto('/admin/connectors?edition=enterprise');
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? problems.join('\n') : 'No page errors or horizontal overflow.');

// Screenshots of the proposed multi-inbox UI in the running seeded mock (run.ts --fake-wa), at desktop
// 1280 px and mobile 360 px: the admin's unified list with the inbox filter, an agent's list (one inbox),
// the Inboxes page, Add inbox with the webhook values, the closed 24-hour window and the template dialog,
// Members with inbox access, and an agent who opens a chat of another inbox. Reports page errors and
// horizontal overflow. Run it once on a freshly started mock (it saves an inbox).
// Usage: node docs/features/multi-inbox/mock/inbox-shots.mjs [baseUrl]
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
const jid = (n) => encodeURIComponent(`6012${n}@s.whatsapp.net`);

async function session(vp, size, username) {
  const ctx = await browser.newContext({ viewport: size, baseURL: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${vp} ${username} pageerror: ${e.message}`));
  const login = await ctx.request.post('/api/auth/login', {
    data: { username, password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login ${username} failed ${login.status()}`);
  const shot = async (n, step) => {
    await page.waitForTimeout(700);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (wide) problems.push(`${vp} ${step}: horizontal overflow`);
    await page.screenshot({ path: join(OUT, `${n}-${step}-${vp}.png`) });
  };
  return { ctx, page, shot };
}

for (const [vp, size] of [
  ['desktop', { width: 1280, height: 860 }],
  ['mobile', { width: 360, height: 780 }],
]) {
  // Admin: every inbox, one list.
  const admin = await session(vp, size, 'aisyah');
  await admin.page.goto('/');
  await admin.page.getByTestId('inbox-filter').waitFor();
  await admin.shot('01', 'admin-unified-list', vp);

  await admin.page.goto(`/chats/${jid('5550142')}`);
  await admin.page.getByTestId('window-closed').waitFor();
  await admin.shot('02', 'window-closed', vp);
  await admin.page.getByRole('button', { name: 'Send template' }).click();
  await admin.page.getByTestId('template-preview').waitFor();
  await admin.shot('03', 'template-dialog', vp);
  await admin.page.keyboard.press('Escape');

  await admin.page.goto('/admin/inboxes');
  await admin.page.getByTestId('inbox-card').first().waitFor();
  await admin.shot('04', 'inboxes-page', vp);

  if (vp === 'desktop') {
    await admin.page.getByRole('button', { name: 'Add inbox' }).first().click();
    const dialog = admin.page.getByRole('dialog');
    await dialog.getByLabel('Inbox name').fill('Delivery');
    await dialog.getByLabel('WhatsApp number').fill('+60 11-2233 4455');
    await dialog.getByLabel('Phone number ID').fill('109876543210003');
    await dialog.getByLabel('WhatsApp Business Account ID').fill('201234567890123');
    await dialog.getByLabel('Access token').fill('EAAG-demo-token');
    await dialog.getByLabel('App secret').fill('demo-app-secret');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await admin.page.getByTestId('inbox-webhook').waitFor();
    await admin.page.getByTestId('inbox-webhook').scrollIntoViewIfNeeded();
    await admin.shot('05', 'add-inbox-webhook', vp);
    await admin.page.keyboard.press('Escape');
  } else {
    await admin.page.getByRole('button', { name: 'Add inbox' }).first().click();
    await admin.page.getByRole('dialog').getByLabel('Inbox name').waitFor();
    await admin.shot('05', 'add-inbox-form', vp);
    await admin.page.keyboard.press('Escape');
  }

  await admin.page.goto('/admin/members');
  await admin.page.locator('[data-testid="inbox-access"]:visible').first().waitFor();
  await admin.shot('06', 'members-access', vp);
  await admin.page.getByRole('button', { name: 'Inboxes for Daniel' }).click();
  await admin.page.getByRole('dialog').getByRole('checkbox').first().waitFor();
  await admin.shot('07', 'members-access-dialog', vp);
  await admin.page.keyboard.press('Escape');
  await admin.ctx.close();

  // Agent Mei Ling: only the Catering inbox.
  const agent = await session(vp, size, 'meiling');
  await agent.page.goto('/');
  await agent.page.getByText('Farah', { exact: false }).first().waitFor();
  await agent.shot('08', 'agent-one-inbox', vp);
  await agent.page.goto(`/chats/${jid('8814455')}`);
  await agent.page.getByText('You cannot open this chat').waitFor();
  await agent.shot('09', 'agent-no-access', vp);
  await agent.ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no page errors, no horizontal overflow');
process.exit(problems.length ? 1 : 0);

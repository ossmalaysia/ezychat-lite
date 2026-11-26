// Screenshots of the history-and-message-info proposal in the running mock (run.ts --fake-wa):
//  - History import on Settings → App settings → General, Admin → WhatsApp → Re-link and Admin → Inboxes → Add inbox
//    (each choice, Custom, an invalid Custom, the QR with the chosen value);
//  - Message info for a direct chat (all times, read without a time, sent only, still sending, failed) and a group
//    (several members, long names, none yet), light and dark.
// With `--setup <freshBaseUrl>` it also walks the setup wizard of a runner started with --fresh (account step in the
// UI, then the WhatsApp step: History import before the QR). Desktop 1280 px and phone 360 px (touch). Checks page
// errors and horizontal overflow on every shot. Restart the runners before a run (Re-link changes the fake phone).
// Usage: node docs/features/history-and-message-info/mock/history-info-shots.mjs [baseUrl] [--setup <freshUrl>]
//        (PW_CHROMIUM=<chromium>)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const setupAt = args.indexOf('--setup');
const SETUP = setupAt >= 0 ? args[setupAt + 1] : null;
const BASE = args.find((a, i) => !a.startsWith('--') && i !== setupAt + 1) ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, '..', 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const shots = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const DIRECT = '60123110021@s.whatsapp.net'; // Farah Aziz
const GROUP = '120363025550005@g.us'; // Kopi Apong Staff (a scheduled message from the team)

async function session({ size, scheme = 'light', base = BASE, login = true }) {
  const ctx = await browser.newContext({
    ...sizes[size],
    baseURL: base,
    colorScheme: scheme,
    timezoneId: 'Asia/Kuala_Lumpur',
  });
  await ctx.addInitScript(() => localStorage.setItem('wati.locale', 'en'));
  if (login) {
    const r = await ctx.request.post('/api/auth/login', {
      data: { username: 'aisyah', password: 'demo-pass-123' },
      headers: { origin: base },
    });
    if (!r.ok()) throw new Error(`login failed: ${r.status()}`);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push({ size, error: String(e) }));
  return { ctx, page };
}

async function shoot(page, name, target) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) problems.push({ name, error: 'horizontal overflow' });
  const file = `${name}.png`;
  if (target) {
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width, height: 2400 });
    await page.waitForTimeout(300);
    await target.scrollIntoViewIfNeeded();
    await target.screenshot({ path: join(OUT, file) });
    await page.setViewportSize(size);
  } else {
    await page.waitForTimeout(450); // dialogs fade in
    await page.screenshot({ path: join(OUT, file) });
  }
  shots.push(file);
}

const scenario = (ctx, s) =>
  ctx.request.put('/api/mock/message-info/scenario', {
    data: { scenario: s },
    headers: { origin: BASE, 'content-type': 'application/json' },
  });

// ---------- Message info ----------
async function messageInfo(size, scheme, list) {
  const { ctx, page } = await session({ size, scheme });
  for (const [chat, scen, name] of list) {
    await scenario(ctx, scen);
    await page.goto(`/chats/${encodeURIComponent(chat)}`);
    const ticks = page.getByTestId('message-ticks').last();
    await ticks.waitFor();
    await ticks.click();
    await page.getByTestId('message-info').waitFor();
    await page.getByText(/Sent|Waiting to send|Not sent/).first().waitFor();
    await shoot(page, `${name}-${size}-${scheme}`);
    await page.keyboard.press('Escape');
  }
  await scenario(ctx, 'auto');
  await ctx.close();
}

const direct = [
  [DIRECT, 'allTimes', 'info-01-direct-all-times'],
  [DIRECT, 'readNoTime', 'info-02-direct-read-no-time'],
  [DIRECT, 'sentOnly', 'info-03-direct-sent-only'],
  [DIRECT, 'pending', 'info-04-direct-pending'],
  [DIRECT, 'failed', 'info-05-direct-failed'],
  [GROUP, 'groupSeveral', 'info-06-group-several'],
  [GROUP, 'groupLongNames', 'info-07-group-long-names'],
  [GROUP, 'groupNoneYet', 'info-08-group-none-yet'],
];
for (const size of ['desktop', 'mobile']) {
  await messageInfo(size, 'light', direct);
  await messageInfo(size, 'dark', direct.filter(([, s]) => ['allTimes', 'readNoTime', 'groupSeveral', 'groupLongNames'].includes(s)));
}

// The entry points: ⋮ menu on desktop, press and hold on a phone.
{
  const { ctx, page } = await session({ size: 'desktop' });
  await page.goto(`/chats/${encodeURIComponent(DIRECT)}`);
  const bubble = page.getByTestId('message-ticks').last();
  await bubble.waitFor();
  const row = bubble.locator('xpath=ancestor::div[contains(@class,"group relative")][1]');
  await row.hover();
  await row.getByTestId('message-more').click();
  await page.getByTestId('message-info-action').waitFor();
  await shoot(page, 'info-00-menu-desktop-light');
  await ctx.close();
}

// ---------- Settings → General ----------
for (const size of ['desktop', 'mobile']) {
  const { ctx, page } = await session({ size });
  await page.goto('/admin/settings/general');
  const card = page.getByTestId('history-import');
  await card.waitFor();
  await shoot(page, `history-01-settings-${size}`, card.locator('xpath=ancestor::*[@data-slot="card"][1]'));
  await card.getByText('Custom', { exact: true }).click();
  await page.getByTestId('history-custom').fill('400');
  await shoot(page, `history-02-settings-custom-invalid-${size}`, card.locator('xpath=ancestor::*[@data-slot="card"][1]'));
  await page.getByTestId('history-custom').fill('90');
  await shoot(page, `history-03-settings-custom-90-${size}`, card.locator('xpath=ancestor::*[@data-slot="card"][1]'));
  await ctx.close();
}

// ---------- Admin → Inboxes → Add inbox (Enterprise) ----------
for (const size of ['desktop', 'mobile']) {
  const { ctx, page } = await session({ size });
  await page.goto('/admin/inboxes?edition=enterprise');
  await page.getByRole('button', { name: 'Add inbox' }).first().click();
  await page.getByTestId('history-import').waitFor();
  await page.getByLabel('Name', { exact: false }).first().fill('Bayan Lepas outlet');
  await page.getByTestId('history-import').getByText('7 days').click();
  await shoot(page, `history-04-add-inbox-${size}`);
  await page.getByRole('button', { name: /^Save/ }).click();
  await page.getByTestId('inbox-qr').waitFor();
  await shoot(page, `history-05-add-inbox-qr-${size}`);
  await ctx.close();
}

// ---------- Admin → WhatsApp → Re-link (Lite), last: it changes the fake phone ----------
for (const size of ['desktop', 'mobile']) {
  const { ctx, page } = await session({ size });
  await page.goto('/admin/whatsapp?edition=lite');
  await page.getByRole('button', { name: 'Re-link' }).first().click();
  await page.getByTestId('history-import').waitFor();
  await shoot(page, `history-06-relink-default-${size}`);
  await page.getByTestId('history-import').getByText('Custom', { exact: true }).click();
  await page.getByTestId('history-custom').fill('abc');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Re-link' }).click();
  await page.getByRole('alert').first().waitFor();
  await shoot(page, `history-07-relink-invalid-${size}`);
  await page.getByTestId('history-custom').fill(size === 'desktop' ? '60' : '0');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Re-link' }).click();
  await page.getByRole('alertdialog').waitFor({ state: 'detached' });
  // The fake phone re-opens at once; put it back on a QR code like a real re-link.
  await ctx.request.post('/api/mock/wa-qr', { headers: { origin: BASE } });
  await page.getByTestId('history-summary').waitFor({ timeout: 15000 });
  await shoot(page, `history-08-relink-qr-${size}`);
  await ctx.close();
}

// ---------- Setup wizard (fresh runner) ----------
if (SETUP) {
  const { ctx, page } = await session({ size: 'desktop', base: SETUP, login: false });
  await page.goto('/');
  await page.getByLabel('Business name').fill('Kopi Apong');
  await page.getByLabel('Your name').fill('Aisyah');
  await page.getByLabel('Password', { exact: true }).fill('demo-pass-123');
  const confirm = page.getByLabel('Confirm password');
  if (await confirm.count()) await confirm.fill('demo-pass-123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('history-step').waitFor({ timeout: 20000 });
  for (const size of ['desktop', 'mobile']) {
    await page.setViewportSize(sizes[size].viewport);
    await shoot(page, `history-09-setup-choice-${size}`);
  }
  await page.setViewportSize(sizes.desktop.viewport);
  await page.getByTestId('history-step').getByText('Custom', { exact: true }).click();
  await page.getByTestId('history-custom').fill('');
  await page.getByTestId('history-show-qr').click();
  await shoot(page, 'history-10-setup-custom-empty-desktop');
  await page.getByTestId('history-custom').fill('120');
  await shoot(page, 'history-11-setup-custom-120-desktop');
  await page.getByTestId('history-show-qr').click();
  await page.getByTestId('history-summary').waitFor();
  await shoot(page, 'history-12-setup-qr-desktop');
  await page.setViewportSize(sizes.mobile.viewport);
  await shoot(page, 'history-12-setup-qr-mobile');
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ shots, problems }, null, 2) + '\n');
console.log(`${shots.length} shots, ${problems.length} problems`);
if (problems.length) console.log(JSON.stringify(problems, null, 2));

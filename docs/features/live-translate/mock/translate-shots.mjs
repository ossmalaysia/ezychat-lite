// Screenshots of the proposed Live translate (live-translate) in the running seeded mock (run.ts --fake-wa):
// desktop 1280 px and phone 360 px (touch), light, dark for the main chat states. Aisyah (admin) writes Malay;
// Tan Wei Jie writes Chinese (long and mixed messages), Emily Carter English; Daniel is a teammate with
// Live translate off. Checks: page errors and horizontal overflow on every shot. Restart the runner before a run
// (it sends messages). Ends with ../screenshots/results.json.
// Usage: node docs/features/live-translate/mock/translate-shots.mjs [baseUrl]   (PW_CHROMIUM=<chromium>)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, '..', 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const shots = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
const TAN = '60127020388@s.whatsapp.net';
const EMILY = '6591234567@s.whatsapp.net';
const RESELLERS = '120363025550003@g.us';
const REPLY =
  'Boleh. Jumlahnya RM1,260.00 termasuk penghantaran. Saya hantar sebut harga hari ini.';

async function session(user, { size, scheme = 'light', locale = 'en' }) {
  const ctx = await browser.newContext({
    ...sizes[size],
    baseURL: BASE,
    colorScheme: scheme,
    timezoneId: 'Asia/Kuala_Lumpur',
  });
  await ctx.addInitScript((loc) => localStorage.setItem('wati.locale', loc), locale);
  const login = await ctx.request.post('/api/auth/login', {
    data: { username: user, password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login ${user} failed ${login.status()}`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12_000);
  const suffix = `${size === 'desktop' ? 'd1280' : 'm360'}-${scheme}${locale === 'en' ? '' : `-${locale}`}`;
  page.on('pageerror', (e) => problems.push(`${user} ${suffix} pageerror: ${e.message}`));
  const put = (path, data) => ctx.request.put(`/api${path}`, { data, headers: { origin: BASE } });
  const shot = async (name, { full = false } = {}) => {
    await page.waitForTimeout(450);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow) problems.push(`${user} ${suffix} ${name}: horizontal overflow`);
    const file = `${name}-${suffix}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: full });
    shots.push(file);
  };
  return {
    ctx,
    page,
    shot,
    scenario: (scenario) => put('/mock/live-translate/scenario', { scenario }),
    chatPref: (jid, body) => put(`/mock/live-translate/chats/${encodeURIComponent(jid)}`, body),
    open: async (jid) => {
      await page.goto(`/chats/${encodeURIComponent(jid)}`);
      await page.locator('textarea').first().waitFor();
      await page.waitForTimeout(900);
    },
    type: async (text) => {
      const box = page.getByRole('textbox', { name: 'Message', exact: true });
      await box.fill(text);
      // Touch keyboards add a new line on Enter: press the Send button there.
      if (size === 'mobile') await page.getByRole('button', { name: 'Send', exact: true }).click();
      else await box.press('Enter');
      await page.getByTestId('translate-preview').waitFor();
    },
  };
}

const scrollBottom = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('*'))
      if (el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY === 'auto')
        el.scrollTop = el.scrollHeight;
  });

// ── Desktop, admin (Aisyah, Malay) ────────────────────────────────────────────────────────────
{
  const s = await session('aisyah', { size: 'desktop' });
  const { page } = s;
  await s.scenario('normal');

  // Settings → AI: the team switch, model, daily limit.
  await page.goto('/admin/settings/ai');
  await page.getByTestId('live-translate-settings').scrollIntoViewIfNeeded();
  await s.shot('01-settings-ai');

  // Account → My language.
  await page.goto('/account');
  await page.getByTestId('my-language').waitFor();
  await s.shot('02-account-my-language');

  // Chat with Live translate on (seeded): translated bubbles, long and mixed text.
  await s.open(TAN);
  await scrollBottom(page);
  await s.shot('03-chat-on');

  // One bubble's original.
  await page.getByRole('button', { name: 'Show original' }).last().click();
  await s.shot('04-show-original');
  await page.getByRole('button', { name: 'Hide original' }).last().click();

  // Show originals for the whole chat.
  await page.getByTestId('translate-originals').click();
  await scrollBottom(page);
  await s.shot('05-show-originals-all');
  await page.getByTestId('translate-originals').click();

  // Languages popover.
  await page.getByTestId('translate-languages').click();
  await s.shot('06-languages-popover');
  await page.keyboard.press('Escape');

  // Check before sending.
  await s.type(REPLY);
  await page.getByTestId('translate-send').waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="translate-send"]')?.disabled,
  );
  await s.shot('07-preview');

  // The staff changes a word of the translation.
  const draft = page.getByTestId('translate-preview-text');
  await draft.fill((await draft.inputValue()).replace('今天', '今天下午'));
  await s.shot('08-preview-edited');

  // Sent: the bubble keeps what was typed; the customer got Chinese.
  await page.getByTestId('translate-send').click();
  await page.getByTestId('translate-preview').waitFor({ state: 'detached' });
  await page.waitForTimeout(1500);
  await scrollBottom(page);
  await s.shot('09-sent');
  await page.getByRole('button', { name: 'Show what was sent' }).last().click();
  await scrollBottom(page);
  await s.shot('10-sent-show-what-was-sent');

  // The customer writes again: translated as it arrives.
  await page.getByTestId('translate-mock-incoming').click();
  await page.waitForTimeout(1800);
  await scrollBottom(page);
  await s.shot('11-customer-writes');

  // Guard: the translation changed a price → refused.
  await s.scenario('number_changed');
  await s.type(REPLY);
  await page.getByText('Translation not used').waitFor();
  await s.shot('12-preview-refused');
  await page.getByRole('button', { name: 'Discard' }).click();

  // Daily limit reached.
  await s.scenario('limit');
  await s.type('Terima kasih! Kami tunggu jawapan anda.');
  await page.getByText(/today's .* translations/).waitFor();
  await s.shot('13-preview-limit');
  await page.getByRole('button', { name: 'Discard' }).click();

  // No AI connection: bar warning, bubbles stay as sent, preview error with Send in Malay.
  await s.scenario('no_connection');
  await page.reload();
  await page.getByTestId('translate-bar').waitFor();
  await page.waitForTimeout(1200);
  await scrollBottom(page);
  await s.type('Terima kasih! Kami tunggu jawapan anda.');
  await page.getByText(/AI connection needs attention/).waitFor();
  await s.shot('14-no-ai-connection');
  await page.getByRole('button', { name: 'Discard' }).click();

  // The model fails on new messages: "Couldn't translate · Try again".
  await s.scenario('error');
  await page.reload();
  await page.getByTestId('bubble-failed').first().waitFor();
  await scrollBottom(page);
  await s.shot('15-translation-failed');

  // Send in Malay instead (the way out when translation is not possible).
  await s.type('Terima kasih! Kami tunggu jawapan anda.');
  await page.getByTestId('translate-send-original').click();
  await page.waitForTimeout(1500);
  await scrollBottom(page);
  await s.shot('16-sent-original');
  await s.scenario('normal');

  // Turning it off: the real messages, as sent and received.
  await page.reload();
  await page.getByTestId('translate-languages').click();
  await page.getByTestId('translate-off').click();
  await page.waitForTimeout(1200);
  await scrollBottom(page);
  await s.shot('17-chat-off');

  // An English customer: detected, turned on from the header.
  await s.open(EMILY);
  await s.shot('18-english-off');
  await page.locator('[data-testid="translate-toggle"]:visible').click();
  await page.getByTestId('translate-bar').waitFor();
  await page.waitForTimeout(1200);
  await s.shot('19-english-on');
  await s.type('Ya, ada. Satu kotak RM68 dan penghantaran ke Singapura RM120 untuk semua kotak.');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="translate-send"]')?.disabled,
  );
  await s.shot('20-english-preview');
  await page.getByRole('button', { name: 'Discard' }).click();

  // A group: each member's language.
  await s.chatPref(RESELLERS, { on: true });
  await s.open(RESELLERS);
  await scrollBottom(page);
  await s.shot('21-group-on');
  await s.chatPref(RESELLERS, { on: false });
  await s.chatPref(TAN, { on: true });
  await s.ctx.close();
}

// ── Desktop, teammate with Live translate off (Daniel) ────────────────────────────────────────
{
  const s = await session('daniel', { size: 'desktop' });
  await s.open(TAN);
  await scrollBottom(s.page);
  await s.shot('22-teammate-off');
  await s.page.getByRole('button', { name: 'Show what was typed' }).first().click();
  await s.shot('23-teammate-show-typed');
  await s.ctx.close();
}

// ── Admin switched it off: no Translate button, no My language ────────────────────────────────
{
  const s = await session('aisyah', { size: 'desktop' });
  await s.ctx.request.put('/api/mock/live-translate/settings', {
    data: { enabled: false },
    headers: { origin: BASE },
  });
  await s.open(EMILY);
  await s.shot('24-admin-off-chat');
  await s.ctx.request.put('/api/mock/live-translate/settings', {
    data: { enabled: true },
    headers: { origin: BASE },
  });
  await s.ctx.close();
}

// ── Desktop dark, phone light and dark ────────────────────────────────────────────────────────
for (const [size, scheme] of [
  ['desktop', 'dark'],
  ['mobile', 'light'],
  ['mobile', 'dark'],
]) {
  const s = await session('aisyah', { size, scheme });
  const { page } = s;
  await s.scenario('normal');
  await s.open(TAN);
  await scrollBottom(page);
  await s.shot('03-chat-on');
  await s.type(REPLY);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="translate-send"]')?.disabled,
  );
  await s.shot('07-preview');
  await page.getByRole('button', { name: 'Discard' }).click();
  if (size === 'mobile') {
    await page.getByTestId('translate-languages').click();
    await s.shot('06-languages-popover');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Show original' }).last().click();
    await s.shot('04-show-original');
    if (scheme === 'light') {
      await page.goto('/admin/settings/ai');
      await page.getByTestId('live-translate-settings').scrollIntoViewIfNeeded();
      await s.shot('01-settings-ai');
      await page.goto('/account');
      await page.getByTestId('my-language').scrollIntoViewIfNeeded();
      await s.shot('02-account-my-language');
    }
  }
  await s.ctx.close();
}

// ── Malay and Chinese app language (catalogs) ─────────────────────────────────────────────────
for (const locale of ['ms', 'zh-CN']) {
  const s = await session('aisyah', { size: 'desktop', locale });
  await s.open(TAN);
  await scrollBottom(s.page);
  await s.shot('03-chat-on');
  await s.ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ shots, problems }, null, 2) + '\n');
console.log(`${shots.length} shots, ${problems.length} problems`);
for (const p of problems) console.log(' -', p);

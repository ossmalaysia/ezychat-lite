// Screenshots of Fix English in the real app, against e2e/agents-devbuild.ts (mock model, fake
// WhatsApp) after e2e/devbuild-fix-english-check.mjs has run there (its admin and Nurul's chat).
// Desktop 1280 px and mobile 360 px (touch), light and dark: spelling marked at once (the real
// dictionary in the browser), grammar after the pause (mock model), the card, Fix all with Undo,
// an unknown word with Add to team words, Malay not checked, a long draft, and Settings → AI → Fix
// English with the team words. Reports page errors, horizontal overflow and failed steps.
// Usage: node e2e/fix-english-screens.mjs <port> <outDir>
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, join } from 'node:path';

const PORT = Number(process.argv[2] ?? 7491);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const BASE = `http://127.0.0.1:${PORT}`;
const JID = '60129990777@s.whatsapp.net';
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'fix-english-screens');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
mkdirSync(OUT, { recursive: true });

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');

const DRAFT = 'Hi Nurul, your order have been ship tommorow. pls check you email for a update ';
const LONG =
  'Hi Nurul, thank you for waiting. i will send the invoice for RM480 tommorow morning lah, and ' +
  'your parcel have been ship to Bayan Lepas. If you need a extra tray of nasi lemak, pls tell us ' +
  'before Thursday ya. Our kopitiam opens at 7am ';
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
let shots = 0;
const sizes = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};

for (const scheme of ['light', 'dark'])
  for (const [sizeName, size] of Object.entries(sizes)) {
    const suffix = `${sizeName}-${scheme}`;
    const mobile = sizeName === 'mobile';
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
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
    const shot = async (name) => {
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
      await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`) });
      shots++;
    };
    const step = async (name, run) => {
      try {
        await run();
      } catch (e) {
        problems.push(`${suffix} ${name}: ${String(e.message).split('\n')[0]}`);
      }
    };
    const composer = page.getByLabel('Message', { exact: true });
    const marks = page.getByTestId('fix-english-marks').locator('[data-issue]');
    const pointAt = async (word) => {
      const box = await marks.filter({ hasText: word }).first().boundingBox();
      if (!box) throw new Error(`no mark on ${word}`);
      if (mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByTestId('fix-english-card').waitFor();
    };

    await page.goto(`/chats/${encodeURIComponent(JID)}`);
    await composer.waitFor();

    await step('spelling at once', async () => {
      await composer.fill(DRAFT);
      // Before the pause: only the dictionary's marks (red), no grammar yet.
      await page.waitForFunction(
        () => document.querySelectorAll('[data-issue].decoration-destructive').length >= 2,
        null,
        { timeout: 15_000 },
      );
      await shot('01-spelling-at-once');
    });
    await step('grammar after the pause', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-issue].decoration-info').length >= 1,
        null,
        { timeout: 8_000 },
      );
      await page.getByTestId('fix-english-fix-all').waitFor();
      await shot('02-spelling-and-grammar');
    });
    await step('card', async () => {
      await pointAt('tommorow');
      await shot('03-card');
      await page.getByTestId('fix-english-card').getByRole('button', { name: 'tomorrow' }).click();
      const value = await composer.inputValue();
      if (!value.includes('ship tomorrow.')) throw new Error(`card fix gave: ${value}`);
    });
    await step('fix all', async () => {
      await page.getByTestId('fix-english-fix-all').click();
      await page.getByTestId('fix-english-undo').waitFor();
      await shot('04-fixed-undo');
      await page.getByRole('button', { name: 'Undo' }).click();
    });
    await step('unknown word', async () => {
      await composer.fill('Hi Nurul, the zarqonia is ready today. ');
      await marks.filter({ hasText: 'zarqonia' }).waitFor({ timeout: 10_000 });
      await pointAt('zarqonia');
      await page.getByTestId('fix-english-add-word').waitFor();
      await shot('05-unknown-word');
      await page.getByTestId('fix-english-add-word').click();
      await marks.filter({ hasText: 'zarqonia' }).waitFor({ state: 'detached', timeout: 5_000 });
      await req('DELETE', '/api/fix-english/words/zarqonia');
    });
    await step('malay', async () => {
      await composer.fill('Boleh, saya check dulu ya, tommorow saya update ');
      await page.waitForTimeout(1_200);
      if (await marks.count()) throw new Error('Malay text was marked');
      await shot('06-malay-not-checked');
    });
    await step('long draft', async () => {
      await composer.fill(LONG);
      await page.waitForFunction(
        () => document.querySelectorAll('[data-issue].decoration-info').length >= 1,
        null,
        { timeout: 8_000 },
      );
      const words = await marks.allTextContents();
      if (words.some((w) => /RM|480|lah|lemak|Bayan|Lepas|kopitiam|ya/.test(w)))
        throw new Error(`marked a protected word: ${words}`);
      await shot('07-long-draft');
    });
    await step('settings', async () => {
      await composer.fill('');
      await req('POST', '/api/fix-english/words', { word: 'cendol' });
      await page.goto('/admin/settings/ai');
      const card = page.getByTestId('fix-english-settings');
      await card.waitFor();
      await card.scrollIntoViewIfNeeded();
      await shot('08-settings');
      await page.getByTestId('team-words').scrollIntoViewIfNeeded();
      await shot('09-team-words');
      await req('DELETE', '/api/fix-english/words/cendol');
    });
    await ctx.close();
  }

await browser.close();
console.log(JSON.stringify({ shots, problems }, null, 2));
process.exitCode = problems.length ? 1 : 0;

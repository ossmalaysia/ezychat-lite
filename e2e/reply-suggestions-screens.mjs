// Screenshots of AI reply suggestions in the real app (fresh standalone server with --fake-wa), for the
// screen review and docs/screenshots/chat + ai-settings. The three AI calls are answered in the
// browser with demo drafts, so no model is ever called.
// Usage: node e2e/reply-suggestions-screens.mjs <port> <outDir>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = Number(process.argv[2] ?? 7477);
const OUT = resolve(process.argv[3] ?? 'reply-suggestions-screens');
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };
const NURUL = '60126677889@s.whatsapp.net';
const AHMAD = '60125550142@s.whatsapp.net';
const DRAFTS = {
  suggestions: [
    {
      label: 'Confirm price, ask the name',
      text: 'Hi Nurul! Two Nasi Lemak Ayam at RM12 each for pickup at 1pm. May I have your name for the order?',
    },
    {
      label: 'Offer a drink with it',
      text: 'Hi Nurul! Noted: two Nasi Lemak Ayam (RM12 each) for pickup at 1pm. Would you like a Kopi O (RM3.50) or Teh Tarik (RM4) with it?',
    },
  ],
  noAnswer: false,
  handoffRule: null,
};
const STATUS = { enabled: true, connected: true, state: 'on', upgraded: false };

async function post(path, body, cookie = '') {
  const res = await fetch(BASE + '/api' + path, {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? cookie };
}

if ((await (await fetch(BASE + '/api/setup/status')).json()).needsSetup)
  await post('/setup/admin', ADMIN);
const { cookie } = await post('/auth/login', {
  username: ADMIN.username,
  password: ADMIN.password,
});
for (const [jid, name, text] of [
  [AHMAD, 'Ahmad Zulkifli', 'Is the shop open on Hari Raya?'],
  [NURUL, 'Nurul Huda', 'Can I order two Nasi Lemak for pickup at 1pm?'],
])
  await post('/dev/fake-incoming', { chatJid: jid, senderName: name, text }, cookie);

const browser = await chromium
  .launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
  .catch(() => chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' }));
const problems = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  mobile: {
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};
for (const scheme of ['light', 'dark'])
  for (const [size, options] of Object.entries(sizes)) {
    const tag = `${size}${scheme === 'dark' ? '-dark' : ''}`;
    const ctx = await browser.newContext({ ...options, baseURL: BASE, colorScheme: scheme });
    const [name, value] = cookie.split('=');
    await ctx.addCookies([{ name, value, url: BASE }]);
    await ctx.route('**/api/reply-suggestions', (r) => r.fulfill({ json: STATUS }));
    await ctx.route(/\/ai\/suggestions$/, (r) =>
      r.fulfill({
        json: r.request().url().includes(encodeURIComponent(AHMAD))
          ? { suggestions: [], noAnswer: true, handoffRule: null }
          : DRAFTS,
      }),
    );
    await ctx.route(/\/ai\/complete$/, (r) =>
      r.fulfill({ json: { completion: 'two Nasi Lemak Ayam are RM24 for pickup at 1pm.' } }),
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
    const shot = async (file) => {
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        )
      )
        problems.push(`${tag} ${file}: horizontal overflow`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${file}-${tag}.png`) });
    };
    const open = async (jid) => {
      await page.goto(`/chats/${encodeURIComponent(jid)}`);
      await page.getByRole('button', { name: 'Suggest reply' }).waitFor();
    };

    await open(NURUL);
    await page.getByRole('button', { name: 'Suggest reply' }).click();
    await page.getByTestId('suggestion-chip').first().waitFor();
    await shot('suggest-chips');
    await page.getByTestId('suggestion-chip').first().click();
    await shot('suggest-draft');

    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('');
    await box.pressSequentially('Hi Nurul, ', { delay: 20 });
    await page
      .getByTestId(size === 'mobile' ? 'accept-completion' : 'completion-hint')
      .waitFor({ timeout: 5_000 });
    await shot('suggest-completion');

    await open(AHMAD);
    await page.getByRole('button', { name: 'Suggest reply' }).click();
    await page.getByTestId('suggestion-note').waitFor();
    await shot('suggest-no-answer');

    await page.goto('/admin/settings/ai');
    const card = page.getByTestId('reply-suggestions-settings');
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await shot('reply-suggestions-settings');
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? `Problems:\n${problems.join('\n')}` : 'No problems found.');
console.log(`Saved reply suggestion screenshots in ${OUT}`);

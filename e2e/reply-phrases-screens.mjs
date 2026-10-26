// Screenshots of the phrase list (instant grey text) in the real app (fresh standalone server with
// --fake-wa), for the screen review and docs/screenshots/chat + ai-settings. The status, the phrase
// lists and the model info are answered in the browser with demo data, so no model is ever called.
// Usage: node e2e/reply-phrases-screens.mjs <port> <outDir>
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const PORT = Number(process.argv[2] ?? 7477);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
/** Screenshots go only inside this repository or the system temp folder. */
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'reply-phrases-screens');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };
const NURUL = '60126677889@s.whatsapp.net';
const SITI = '60131234567@s.whatsapp.net';
const PHRASES = [
  ['Thank you for your message! We will get back to you shortly.', 'en', 'team', 41],
  ['Do you have any other questions?', 'en', 'team', 33],
  ['Terima kasih atas mesej anda! Kami akan balas secepat mungkin.', 'ms', 'team', 22],
  ['Our opening hours are 8am to 10pm daily.', 'en', 'context', 18],
  ['May I have your name and phone number for the order?', 'en', 'team', 15],
  ['Ada apa-apa lagi yang boleh kami bantu?', 'ms', 'team', 14],
  ['Nasi Lemak Ayam is RM12, Kopi O is RM3.50 and Teh Tarik is RM4.', 'en', 'context', 12],
  ['Is it for delivery or pickup?', 'en', 'team', 11],
  ['谢谢您的留言！我们会尽快回复您。', 'zh', 'team', 9],
  ['We deliver within 5 km of Georgetown, free for orders above RM40.', 'en', 'context', 9],
  ['Kami buka setiap hari dari 8 pagi hingga 10 malam.', 'ms', 'context', 6],
  ['我们每天早上8点到晚上10点营业。', 'zh', 'context', 4],
].map(([text, language, source, uses], i) => ({
  id: i + 1,
  text,
  language,
  source,
  uses,
  fact: /\d/.test(text),
}));
const counts = (list) =>
  ['en', 'ms', 'zh']
    .map((language) => ({ language, count: list.filter((p) => p.language === language).length }))
    .filter((l) => l.count > 0);
const admin = (state, list = PHRASES) => ({
  agentId: 1,
  status: {
    state,
    count: list.length,
    languages: counts(list),
    updatedAt: state === 'empty' ? null : Date.now() - 12 * 60_000,
    trigger: state === 'empty' ? null : 'replies',
    newReplies: 18,
    nextAfterReplies: 30,
    aiCallsToday: 4,
    aiCallsLimit: 24,
  },
  phrases: list,
});
const MODEL = {
  model: 'fast',
  fastModel: 'gpt-6-luna',
  agentModel: 'gpt-6.1-sol',
  models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.5'],
  resolved: 'gpt-6-luna',
};

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
  [SITI, 'Siti Rahman', 'Ada hantar ke Bayan Lepas tak?'],
  [NURUL, 'Nurul Huda', 'What time do you open on Saturday?'],
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
    let status = { enabled: true, connected: true, state: 'on', upgraded: false };
    let adminData = admin('ready');
    await ctx.route('**/api/reply-suggestions', (r) => r.fulfill({ json: status }));
    await ctx.route(/\/chats\/[^/]+\/ai\/phrases$/, (r) =>
      r.fulfill({
        json: { phrases: PHRASES.map(({ id, text, language }) => ({ id, text, language })) },
      }),
    );
    await ctx.route(/\/ai\/phrases\/\d+\/feedback$/, (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.route(/\/ai\/complete$/, (r) => r.fulfill({ json: { completion: null } }));
    await ctx.route('**/api/ai/reply-suggestions/model', (r) => r.fulfill({ json: MODEL }));
    await ctx.route(/\/api\/ai\/phrases\?/, (r) => r.fulfill({ json: adminData }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
    const shot = async (file) => {
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        )
      )
        problems.push(`${tag} ${file}: horizontal overflow`);
      // Dialogs and Selects animate open; a just-enabled button fades from grey.
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `${file}-${tag}.png`) });
    };
    const open = async (jid) => {
      await page.goto(`/chats/${encodeURIComponent(jid)}`);
      await page.getByRole('button', { name: 'Suggest reply' }).waitFor();
    };
    const box = page.getByRole('textbox', { name: 'Message' });

    await open(NURUL);
    await box.pressSequentially('Our open', { delay: 30 });
    await page.getByTestId('completion-ghost').filter({ hasText: 'hours' }).waitFor();
    await shot('phrase-completion');
    await open(SITI);
    await box.pressSequentially('Terima kasih ', { delay: 30 });
    await page.getByTestId('completion-ghost').filter({ hasText: 'mesej' }).waitFor();
    await shot('phrase-completion-malay');

    const settings = async () => {
      await page.goto('/admin/settings/ai');
      await page.getByTestId('phrase-dictionary-settings').waitFor();
    };
    await settings();
    await page.getByTestId('reply-suggestions-settings').scrollIntoViewIfNeeded();
    await shot('suggest-model-settings');
    await page.getByTestId('phrase-dictionary-settings').scrollIntoViewIfNeeded();
    await shot('phrase-settings');
    await page.getByRole('button', { name: 'View phrases' }).click();
    await page.getByTestId('phrase-list').waitFor();
    await shot('phrase-list');
    await page.getByTestId('phrase-list').getByRole('button', { name: 'Add phrase' }).click();
    await page
      .getByTestId('phrase-list')
      .getByRole('textbox', { name: 'Add phrase' })
      .fill('We are closed on the first Monday of each month.');
    await shot('phrase-add');
    await page.keyboard.press('Escape');

    for (const [file, data, next] of [
      ['phrase-building', admin('building'), null],
      ['phrase-empty', admin('empty', []), null],
      [
        'phrase-off',
        admin('ready'),
        { enabled: false, connected: true, state: 'off', upgraded: false },
      ],
    ]) {
      adminData = data;
      if (next) status = next;
      await settings();
      await page.getByTestId('phrase-dictionary-settings').scrollIntoViewIfNeeded();
      await shot(file);
    }
    await ctx.close();
  }
await browser.close();
console.log(problems.length ? `Problems:\n${problems.join('\n')}` : 'No problems found.');
console.log(`Saved phrase list screenshots in ${OUT}`);

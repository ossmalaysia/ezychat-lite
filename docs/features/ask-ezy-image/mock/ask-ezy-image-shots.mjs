// Screenshots of the proposed pictures in Ask Ezy (ask-ezy-image) in the running seeded mock (run.ts --fake-wa):
// desktop 1280 px and phone 360 px (touch), light and dark. States: empty, a pasted screenshot, two pictures with a
// question, the answer, a wrong file type, a picture that is too large, the sending state, and an Ask Ezy model that
// cannot read pictures. The "screenshot" Ezy is asked about is a capture of the mock's own chat screen. Checks page
// errors and horizontal overflow on every shot. Ends with ../screenshots/results.json.
// Usage: node docs/features/ask-ezy-image/mock/ask-ezy-image-shots.mjs [baseUrl]   (PW_CHROMIUM=<chromium>)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7489';
const OUT = join(import.meta.dirname, '..', 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
const passed = [];
const sizes = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};

async function login(ctx) {
  const r = await ctx.request.post('/api/auth/login', {
    data: { username: 'aisyah', password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!r.ok()) throw new Error(`login failed ${r.status()}`);
}
const mockState = (ctx, data) =>
  ctx.request.put('/api/mock/ask-ezy/mock-state', {
    data,
    headers: { origin: BASE, 'content-type': 'application/json' },
  });

// The pictures: two captures of the mock's own inbox (a chat screen), made once.
const pics = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, baseURL: BASE });
  await login(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('a[href^="/chats/"]').first().click();
  await page.waitForTimeout(1200);
  const chat = await page.screenshot({ type: 'png' });
  const crop = await page.screenshot({
    type: 'jpeg',
    quality: 80,
    clip: { x: 380, y: 300, width: 700, height: 420 },
  });
  await ctx.close();
  return { chat, crop };
})();
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)]);
const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(21 * 1024 * 1024)]);

async function run(size, scheme) {
  const ctx = await browser.newContext({
    ...sizes[size],
    baseURL: BASE,
    colorScheme: scheme,
    timezoneId: 'Asia/Kuala_Lumpur',
  });
  await ctx.addInitScript(() => localStorage.setItem('wati.locale', 'en'));
  await login(ctx);
  await mockState(ctx, { pictures: true, slow: false });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const suffix = `${size === 'desktop' ? 'd1280' : 'm360'}-${scheme}`;
  page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
  const shot = async (name) => {
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
    await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`) });
    passed.push(`${name}-${suffix}`);
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${suffix} ${name}: ${e.message.split('\n')[0]}`);
    }
  };
  const panel = page.getByTestId('ask-ezy-panel');
  const openPanel = async () => {
    await page.getByTestId(size === 'desktop' ? 'nav-ask-ezy' : 'tab-ask-ezy').click();
    await panel.waitFor();
  };
  const input = () => panel.getByTestId('ask-ezy-picture-input');
  const box = () => panel.locator('textarea');

  await page.goto('/');
  await page.locator('a[href^="/chats/"]').first().waitFor();
  await step('01-empty', async () => {
    await openPanel();
    await panel.getByTestId('ask-ezy-empty').waitFor();
    await shot('01-empty');
  });
  await step('02-pasted', async () => {
    // Ctrl+V of a screenshot: a paste event whose clipboard holds a PNG file.
    await box().focus();
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'Screenshot 2026-11-27 154210.png', { type: 'image/png' }));
      document
        .querySelector('[data-testid="ask-ezy-panel"] textarea')
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
    }, pics.chat.toString('base64'));
    await panel.locator('[data-testid="ask-ezy-pictures"] img').first().waitFor();
    await shot('02-pasted');
  });
  await step('03-two', async () => {
    await input().setInputFiles({
      name: 'chat-part.jpg',
      mimeType: 'image/jpeg',
      buffer: pics.crop,
    });
    await panel.locator('[data-testid="ask-ezy-pictures"] img').nth(1).waitFor();
    await box().fill('What made this trigger?');
    await shot('03-two-pictures');
  });
  await step('07-answer', async () => {
    await box().press('Enter');
    await panel.getByTestId('ask-ezy-answer').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await shot('07-answer');
  });
  await step('04-errors', async () => {
    await panel.getByRole('button', { name: 'Start over' }).click();
    await input().setInputFiles({ name: 'IMG_2041.gif', mimeType: 'image/gif', buffer: gif });
    await panel.getByTestId('ask-ezy-picture-error').waitFor();
    await shot('04-wrong-type');
    await input().setInputFiles({ name: 'IMG_2042.jpg', mimeType: 'image/jpeg', buffer: big });
    await page.waitForTimeout(800);
    await shot('04b-too-large');
  });
  await step('06-sending', async () => {
    await mockState(ctx, { slow: true });
    await input().setInputFiles({ name: 'chat.png', mimeType: 'image/png', buffer: pics.chat });
    await panel.locator('[data-testid="ask-ezy-pictures"] img').first().waitFor();
    await box().fill('Why did the AI hand this chat over?');
    await box().press('Enter');
    await panel.getByTestId('ask-ezy-thinking').waitFor();
    await page.waitForTimeout(900);
    await shot('06-sending');
    await panel.getByRole('button', { name: 'Stop' }).click();
    await mockState(ctx, { slow: false });
  });
  await step('05-unavailable', async () => {
    await mockState(ctx, { pictures: false });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (size === 'desktop')
      await page
        .getByRole('button', { name: 'Close' })
        .first()
        .click()
        .catch(() => {});
    await openPanel();
    await panel
      .getByRole('button', { name: 'Start over' })
      .click()
      .catch(() => {});
    await panel.getByTestId('ask-ezy-attach').click();
    await panel.getByTestId('ask-ezy-pictures-unavailable').waitFor();
    await shot('05-unavailable');
    await mockState(ctx, { pictures: true });
  });
  await ctx.close();
}

for (const size of ['desktop', 'mobile'])
  for (const scheme of ['light', 'dark']) await run(size, scheme);
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ passed, problems }, null, 2) + '\n');
console.log(`${passed.length} shots, ${problems.length} problems`);
for (const p of problems) console.log(' -', p);

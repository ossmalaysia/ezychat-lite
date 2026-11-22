// Screenshots of the proposed AI models card (ai-models-per-task) in the running seeded mock (run.ts --fake-wa):
// Settings → App settings → AI at desktop 1280 px and phone 360 px (touch), light and dark, en/ms/zh-CN, for the
// three connections (ChatGPT sign-in, OpenAI API key, Claude API key), the defaults, a changed choice and a saved
// model the connection no longer lists. Checks page errors and horizontal overflow on every shot. Restart the runner
// before a run (it saves choices). Ends with ../screenshots/results.json.
// Usage: node docs/features/ai-models-per-task/mock/ai-models-shots.mjs [baseUrl]   (PW_CHROMIUM=<chromium>)
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
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  mobile: {
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
};

async function session({ size, scheme = 'light', locale = 'en' }) {
  const ctx = await browser.newContext({
    ...sizes[size],
    baseURL: BASE,
    colorScheme: scheme,
    timezoneId: 'Asia/Kuala_Lumpur',
  });
  await ctx.addInitScript((loc) => localStorage.setItem('wati.locale', loc), locale);
  const login = await ctx.request.post('/api/auth/login', {
    data: { username: 'aisyah', password: 'demo-pass-123' },
    headers: { origin: BASE },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push({ size, error: String(e) }));
  return { ctx, page };
}

const api = (ctx, path, data) =>
  ctx.request.put(path, { data, headers: { origin: BASE, 'content-type': 'application/json' } });

async function openCard(page) {
  await page.goto('/admin/settings/ai');
  const card = page.getByTestId('ai-models-settings');
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  return card;
}

async function shoot(page, name, target) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) problems.push({ name, error: 'horizontal overflow' });
  const file = `${name}.png`;
  if (!target) {
    await page.screenshot({ path: join(OUT, file) });
  } else {
    // The app scrolls inside its own container: grow the window so the whole card is painted.
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width, height: 3600 });
    await page.waitForTimeout(300);
    await target.scrollIntoViewIfNeeded();
    await target.screenshot({ path: join(OUT, file) });
    await page.setViewportSize(size);
  }
  shots.push(file);
}

async function scenario(ctx, body) {
  const r = await api(ctx, '/api/mock/ai-models/scenario', body);
  if (!r.ok()) throw new Error(`scenario ${JSON.stringify(body)}: ${r.status()}`);
}
async function reset(ctx) {
  for (const mode of ['chatgpt', 'api', 'claude']) {
    await scenario(ctx, { mode, removed: false });
    await api(ctx, '/api/mock/ai-models', {
      tasks: { agentReplies: null, askEzy: null, translate: null, writing: null, background: null },
    });
  }
  await scenario(ctx, { mode: 'chatgpt' });
}

for (const size of ['desktop', 'mobile']) {
  const { ctx, page } = await session({ size });
  await reset(ctx);
  // 1. Defaults per connection.
  for (const mode of ['chatgpt', 'api', 'claude']) {
    await scenario(ctx, { mode });
    const card = await openCard(page);
    await shoot(page, `${size}-${mode}-default`, card);
  }
  // 2. A changed choice (ChatGPT): Writing help on the main model with High thinking, not saved yet, then saved.
  await scenario(ctx, { mode: 'chatgpt' });
  let card = await openCard(page);
  const writing = page.getByTestId('ai-models-writing');
  await page.getByTestId('ai-models-writing-select').click();
  await page.waitForTimeout(200);
  await shoot(page, `${size}-chatgpt-select-open`);
  await page.getByRole('option', { name: /^Main model/ }).click();
  await page.waitForTimeout(500);
  await writing.getByText('High', { exact: true }).click();
  await writing.scrollIntoViewIfNeeded();
  await shoot(page, `${size}-chatgpt-changed-unsaved`);
  await page.getByTestId('ai-models-save').click();
  await page.waitForTimeout(300);
  card = await openCard(page);
  await shoot(page, `${size}-chatgpt-changed-saved`, card);
  // 3. Claude keeps its own choices: Translate on Claude Sonnet; ChatGPT still shows its own.
  await scenario(ctx, { mode: 'claude' });
  await api(ctx, '/api/mock/ai-models', { tasks: { translate: { choice: 'claude-sonnet-5-5' } } });
  card = await openCard(page);
  await shoot(page, `${size}-claude-changed`, card);
  // 4. A saved model the ChatGPT account no longer lists.
  await scenario(ctx, { mode: 'chatgpt', removed: true });
  card = await openCard(page);
  await page.getByTestId('ai-models-translate').scrollIntoViewIfNeeded();
  await shoot(page, `${size}-chatgpt-model-removed`, card);
  // 5. The Reply suggestions card now points to AI models.
  await scenario(ctx, { removed: false });
  await page.goto('/admin/settings/ai');
  const suggest = page.getByTestId('reply-suggestions-settings');
  await suggest.waitFor();
  await suggest.scrollIntoViewIfNeeded();
  await shoot(page, `${size}-reply-suggestions-note`, suggest);
  await reset(ctx);
  await ctx.close();
}

// Dark mode and the other two languages (defaults, ChatGPT; one removed-model shot each).
for (const [scheme, locale] of [
  ['dark', 'en'],
  ['light', 'ms'],
  ['light', 'zh-CN'],
]) {
  for (const size of ['desktop', 'mobile']) {
    const { ctx, page } = await session({ size, scheme, locale });
    await reset(ctx);
    let card = await openCard(page);
    await shoot(page, `${size}-${scheme}-${locale}-default`, card);
    await scenario(ctx, { mode: 'chatgpt', removed: true });
    card = await openCard(page);
    await shoot(page, `${size}-${scheme}-${locale}-model-removed`, card);
    await reset(ctx);
    await ctx.close();
  }
}

await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ shots, problems }, null, 2) + '\n');
console.log(`${shots.length} shots, ${problems.length} problems`);
if (problems.length) console.log(JSON.stringify(problems, null, 2));

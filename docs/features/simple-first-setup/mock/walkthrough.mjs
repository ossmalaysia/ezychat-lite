// Walks the fresh-install journey of this mock and saves screenshots (desktop 1280 px + mobile
// 360 px, light). Start the mock first:  npx tsx docs/features/simple-first-setup/mock/run.ts --fake-wa --fresh
// then:  node docs/features/simple-first-setup/mock/walkthrough.mjs [baseUrl]
// Each viewport needs its own fresh mock (setup runs once per install): pass --only=desktop|mobile.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:7487';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'desktop';
const out = join(here, 'screenshots');
await mkdir(out, { recursive: true });
const viewport = only === 'mobile' ? { width: 360, height: 780 } : { width: 1280, height: 860 };
// PW_CHROMIUM: path to an installed Chromium when the bundled browser is not downloaded.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const context = await browser.newContext({ viewport, colorScheme: 'light', locale: 'en-US' });
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
let interactions = 0; // clicks + fields filled, counted from first launch to AI on
const click = async (locator) => {
  interactions++;
  await locator.click();
};
const fill = async (locator, value) => {
  interactions++;
  await locator.fill(value);
};
const shot = async (name) => {
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (overflow) problems.push(`${name}: horizontal overflow`);
  await page.screenshot({ path: join(out, `${name}-${only}.png`), fullPage: true });
};

await page.goto(base);
await page.waitForURL('**/setup');
await page.getByLabel('Business name').waitFor();
await shot('01-account-empty');
await fill(page.getByLabel('Business name'), 'Kopi Apong');
await fill(page.getByLabel('Your name'), 'Aisyah Rahman');
await fill(page.getByLabel('Password', { exact: true }), 'demo-pass-123');
await shot('02-account-filled');
await click(page.getByRole('button', { name: 'Continue' }));
await page.getByText('Link your WhatsApp number').waitFor();
await page.getByRole('button', { name: 'Demo: simulate scanning the code' }).waitFor();
await shot('03-whatsapp-qr');
await click(page.getByRole('button', { name: 'Demo: simulate scanning the code' }));
await page.getByText('WhatsApp linked').waitFor();
await shot('04-whatsapp-linked');
await click(page.getByRole('button', { name: 'Continue' }));
await page.getByLabel('About your business').waitFor();
await shot('05-ai-step');
interactions++; // the owner types their details into the template (one field)
await page
  .getByLabel('About your business')
  .fill(
    'Kopi Apong\nOpening hours: daily 8am–10pm.\nProducts & prices: Kopi O RM3.50, Teh Tarik RM4, Nasi Lemak Ayam RM12.\nDelivery: within 5 km of Georgetown, free above RM40.\nHow to order: send your order here on WhatsApp.',
  );
// API-key path first, to show the Test key error, then back to ChatGPT (not counted).
await page.getByRole('button', { name: 'Use an OpenAI API key instead' }).click();
await page.getByLabel('OpenAI API key').fill('not-a-key');
await page.getByRole('button', { name: 'Test key' }).click();
await page.getByText('OpenAI did not accept this key').waitFor();
await shot('06-ai-key-error');
await page.getByRole('button', { name: 'Use Sign in with ChatGPT instead' }).click();
await click(page.getByRole('button', { name: 'Sign in with ChatGPT' }));
await page.getByText('Signing in').waitFor();
await shot('07-ai-signing-in');
await page.getByText('Connected to ChatGPT').waitFor({ timeout: 10000 });
await shot('08-ai-connected');
await click(page.getByRole('button', { name: 'Finish' }));
await page.getByText('Your inbox is ready').waitFor();
await shot('09-ready');
const journey = interactions;
await page.getByRole('button', { name: 'Go to inbox' }).click();
await page.locator('h2:visible', { hasText: 'Getting started' }).first().waitFor();
await shot('10-inbox-getting-started');

// Sales Agent page: AI is on; Advanced collapsed; Try it answers from the saved business text.
await page.goto(`${base}/admin/members/ai`);
await page.getByText('Advanced: instructions and hand-off rules').waitFor();
await shot('11-sales-agent');
const question = page.getByLabel('Customer question');
await question.fill('How much is a Teh Tarik?');
await page.getByRole('button', { name: 'Ask', exact: true }).click();
await page.getByText('Teh Tarik RM4', { exact: false }).last().waitFor({ timeout: 10000 });
await shot('12-sales-agent-try-it');
await page.getByText('Advanced: instructions and hand-off rules').click();
await shot('13-sales-agent-advanced-open');

// Settings → AI: ChatGPT first, setup link, More AI features collapsed.
await page.goto(`${base}/admin/settings/ai`);
await page.getByText('More AI features').waitFor();
await shot('14-settings-ai');
// Switch to API key, wrong key blocks Save.
await page.getByText('API key', { exact: true }).click();
await page.locator('input[type=password]').first().fill('wrong-key-123');
await page.getByRole('button', { name: 'Test key' }).click();
await page.getByText('OpenAI did not accept this key').waitFor();
await shot('15-settings-key-error');
await page.locator('input[type=password]').first().fill('sk-demo-0123456789');
await page.getByRole('button', { name: 'Test key' }).click();
await page.getByText('Key works.').waitFor();
await shot('16-settings-key-ok');
// Badge click selects ChatGPT again (0.1.36 bug: badge intercepted the click).
const badge = await page.getByText('Recommended').first().boundingBox();
await page.mouse.click(badge.x + badge.width / 2, badge.y + badge.height / 2);
await page.getByText('Uses your ChatGPT account').first().waitFor();

// Phone access page (renamed from Cloudflare).
await page.goto(`${base}/admin/tunnel`);
await page.getByRole('heading', { name: 'Phone access' }).waitFor();
await shot('17-phone-access');

// Not-connected Sales Agent: sign out of ChatGPT, then the inline Connect card shows.
await page.goto(`${base}/admin/settings/ai`);
await page.getByRole('button', { name: 'Sign out' }).click();
await page.getByRole('button', { name: 'Sign in with ChatGPT' }).waitFor();
await page.goto(`${base}/admin/members/ai`);
await page.getByText('Connect the AI', { exact: true }).waitFor();
await shot('18-sales-agent-not-connected');

await browser.close();
console.log(JSON.stringify({ viewport: only, journeyInteractions: journey, problems }, null, 2));

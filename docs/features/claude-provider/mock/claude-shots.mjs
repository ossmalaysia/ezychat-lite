// Screenshots of the proposed Claude API key connection in the running seeded mock (run.ts --fake-wa), at
// desktop 1280 px and mobile 360 px: Settings → AI with three connection options, the Claude option (key
// field, console link, model select, voice note), a rejected key, an unreachable-Anthropic warning, the
// saved key with Test connection, the model list, Voice messages without the cloud option, the agent
// page's connection line, switching back to the OpenAI key (both keys kept) and the inline connect card.
// Reports page errors and horizontal overflow. Each viewport uses a fresh browser context (the mock-only
// Claude state starts empty) and first puts the server back on its seeded OpenAI key connection.
// Usage: node docs/features/claude-provider/mock/claude-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:7493';
const OUT = join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await chromium
  .launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
  .catch(() => chromium.launch({ channel: 'chrome' }));
const problems = [];

for (const [vp, size] of [
  ['desktop', { width: 1280, height: 860 }],
  ['mobile', { width: 360, height: 780 }],
]) {
  const ctx = await browser.newContext({ viewport: size, baseURL: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${vp} pageerror: ${e.message}`));
  const headers = { origin: BASE };
  const login = await ctx.request.post('/api/auth/login', {
    data: { username: 'aisyah', password: 'demo-pass-123' },
    headers,
  });
  if (!login.ok()) throw new Error(`login failed ${login.status()}`);
  // The seeded connection: OpenAI API key (placeholder, never sent anywhere).
  const reset = await ctx.request.patch('/api/ai/connection', {
    data: { mode: 'api', model: '', apiKey: 'sk-demo-placeholder-not-a-key' },
    headers,
  });
  if (!reset.ok()) throw new Error(`reset failed ${reset.status()}`);

  const shot = async (n, step, { full = false, target } = {}) => {
    await page.waitForTimeout(600);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (wide) problems.push(`${vp} ${step}: horizontal overflow`);
    const path = join(OUT, `${n}-${step}-${vp}.png`);
    // Phone: whole page (an element shot of a tall card is cut by the sticky Save bar).
    if (target && vp === 'desktop') await target.screenshot({ path });
    else if (target) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path, fullPage: true });
    } else {
      if (full) await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path, fullPage: full });
    }
  };
  const card = () =>
    page.locator('[data-slot="card"]', { has: page.locator('#ai-mode-claude') }).first();
  const saveButton = () => page.getByRole('button', { name: 'Save AI connection' });

  // 01 Settings → AI: three connection options; the OpenAI key is the saved one.
  await page.goto('/admin/settings/ai');
  await page.locator('#ai-mode-claude').waitFor();
  await page.getByText('OpenAI API key is saved.').waitFor();
  await shot('01', 'settings-modes', { target: card() });

  // 02 Claude API key chosen: key field, console link, model select, voice note.
  await page.locator('label[for="ai-mode-claude"]').click();
  await page.getByLabel('Anthropic API key').waitFor();
  await shot('02', 'settings-claude-new', { target: card() });

  // 03 An OpenAI key in the Claude field: rejected with a pointer to the right option.
  await page.getByLabel('Anthropic API key').fill('sk-proj-abc1234567');
  await page.getByRole('button', { name: 'Test key' }).click();
  await page.getByText('This is an OpenAI key.', { exact: false }).waitFor();
  await shot('03', 'claude-key-rejected', { target: card() });

  // 04 Anthropic could not be reached: warn only, saving stays possible.
  await page.getByLabel('Anthropic API key').fill('sk-ant-offline-123456');
  await page.getByRole('button', { name: 'Test key' }).click();
  await page.getByText('Could not reach Anthropic', { exact: false }).waitFor();
  await shot('04', 'claude-key-warning', { target: card() });

  // 05 A good key, saved (tested first), then Test connection with the saved key.
  await page.getByLabel('Anthropic API key').fill('sk-ant-demo-1234567');
  await saveButton().click();
  await page.getByText('Anthropic API key is saved.').waitFor();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await page.getByText('Claude Sonnet 5.5 replied: Hello!', { exact: false }).waitFor();
  await shot('05', 'claude-saved', { target: card() });

  // 06 The three fixed Claude models.
  await page.getByLabel('Claude model').click();
  await page.getByRole('option', { name: 'Claude Opus 5.5' }).waitFor();
  await shot('06', 'claude-models');
  await page.keyboard.press('Escape');

  // 07 Voice messages under Claude: no cloud option, a note why.
  await page.getByText('More AI features').click();
  const voice = page.locator('[data-slot="card"]', { hasText: 'Voice messages' }).first();
  await voice.getByText('on-device model with Claude', { exact: false }).waitFor();
  if (await voice.locator('#voice-engine-cloud').count())
    problems.push(`${vp}: cloud voice option shown in Claude mode`);
  await shot('07', 'voice-claude', { target: voice });
  // 13 Cloud transcription was chosen before the switch: a warning asks for another choice.
  const cloud = await ctx.request.patch('/api/ai/voice', {
    data: { transcription: 'cloud' },
    headers,
  });
  if (!cloud.ok()) throw new Error(`voice cloud failed ${cloud.status()}`);
  await page.reload();
  await page.getByText('More AI features').click();
  await voice.getByText('Cloud transcription is off', { exact: false }).waitFor();
  await shot('13', 'voice-claude-cloud-was-on', { target: voice });
  await ctx.request.patch('/api/ai/voice', { data: { transcription: 'off' }, headers });

  // 08 Agent page connection line names the Claude key.
  await page.goto('/admin/members/ai/a1');
  await page.getByTestId('agent-page').waitFor();
  const line = page.getByText('Connection: Anthropic API key is saved.');
  await line.scrollIntoViewIfNeeded();
  await shot('08', 'agent-connection-line');

  // 09 Back to the OpenAI key: saved without typing it again; 10 the Claude key is still saved.
  await page.goto('/admin/settings/ai');
  await page.locator('label[for="ai-mode-api"]').click();
  await page.getByText('OpenAI API key is saved.').waitFor();
  await saveButton().click();
  await page.getByText('Inbox AI connection saved.').first().waitFor();
  await shot('09', 'settings-openai-back', { target: card() });
  await page.locator('label[for="ai-mode-claude"]').click();
  await page.getByText('Anthropic API key is saved.').waitFor();
  await shot('10', 'claude-key-kept', { target: card() });

  // 11/12 Inline connect card (agent page, setup wizard): ChatGPT signed out → Use a Claude API key.
  await ctx.request.patch('/api/ai/connection', { data: { mode: 'chatgpt', model: '' }, headers });
  await ctx.request.post('/api/ai/chatgpt/logout', { headers });
  await page.goto('/admin/members/ai/a1');
  const connect = page.getByTestId('agent-connect');
  await connect.waitFor();
  await connect.getByRole('button', { name: 'Use a Claude API key instead' }).click();
  await connect.getByLabel('Anthropic API key').waitFor();
  await shot('11', 'connect-card-claude', { target: connect });
  await connect.getByLabel('Anthropic API key').fill('sk-ant-demo-7654321');
  await connect.getByRole('button', { name: 'Test key' }).click();
  // The card turns into the ready state, then the page hides it (connection ready).
  await page.getByText('Connection: Anthropic API key is saved.').waitFor();
  await shot('12', 'connect-card-saved-page', { full: true });

  await ctx.close();
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Saved the claude-provider screenshots in ${OUT}`);

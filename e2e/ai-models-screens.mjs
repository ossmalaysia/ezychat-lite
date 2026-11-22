// Screenshots of Settings → AI → AI models in the real app (fake WhatsApp, no model is ever called).
// Desktop 1280 px and mobile 360 px (touch), light and dark: ChatGPT defaults, a changed row before Save
// (Writing help on the main model at Smarter), saved, the model list open, a saved model no longer offered
// (warning + fallback), Claude (no Speed and quality), the Reply suggestions pointer line, Malay and Chinese.
// Reports page errors, horizontal overflow and failed steps.
// Usage: node e2e/ai-models-screens.mjs <outDir>   (starts its own server on a temp folder, port 7486)
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';

const repo = resolve(import.meta.dirname, '..');
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const OUT = resolve(repo, process.argv[2] ?? 'ai-models-screens');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
mkdirSync(OUT, { recursive: true });
const PORT = 7486;
const BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), 'ezychat-ai-models-'));

/** One server run on the temp folder (fake WhatsApp, the built web app). */
async function startServer() {
  const child = spawn(
    process.execPath,
    [
      '--conditions=ezychat-source',
      '--import',
      'tsx',
      'packages/server/src/cli.ts',
      '--data',
      data,
      '--port',
      String(PORT),
      '--mode',
      'dev',
      '--fake-wa',
      '--web-dist',
      'apps/web/dist',
    ],
    { cwd: repo, stdio: 'ignore' },
  );
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE + '/api/health')).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('The server did not start');
}
const stop = (child) =>
  new Promise((r) => {
    child.once('exit', r);
    child.kill('SIGTERM');
  });

let server = await startServer();
const json = { 'content-type': 'application/json', origin: BASE };
await fetch(BASE + '/api/setup/admin', {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' }),
});
// A ChatGPT row on a model the account no longer lists: set while the server is stopped.
await stop(server);
const db = new Database(join(data, 'app.db'));
db.prepare(
  "INSERT INTO settings (key, value) VALUES ('ai_task_models', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
).run(JSON.stringify({ chatgpt: { translate: { choice: 'gpt-5.4-terra', thinking: 'low' } } }));
db.close();
server = await startServer();

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
let shots = 0;
const sizes = {
  desktop: { viewport: { width: 1280, height: 900 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
try {
  for (const locale of ['en', 'ms', 'zh-CN'])
    for (const scheme of locale === 'en' ? ['light', 'dark'] : ['light'])
      for (const [sizeName, size] of Object.entries(sizes)) {
        const suffix = `${sizeName}-${scheme}${locale === 'en' ? '' : `-${locale}`}`;
        const ctx = await browser.newContext({ ...size, baseURL: BASE, colorScheme: scheme });
        await ctx.addInitScript((lng) => {
          try {
            localStorage.setItem('wati.locale', lng);
          } catch {
            // private mode
          }
        }, locale);
        const req = (method, path, body) =>
          ctx.request.fetch(path, { method, data: body, headers: { origin: BASE } });
        await req('POST', '/api/auth/login', { username: 'aisyah', password: 'demo-pass-123' });
        await req('PATCH', '/api/ai/connection', { mode: 'chatgpt', model: '' });
        await req('PUT', '/api/ai/task-models', { tasks: { writing: null } });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => problems.push(`${suffix} pageerror: ${e.message}`));
        const card = page.getByTestId('ai-models-settings');
        const shot = async (name, target = card) => {
          await page.waitForTimeout(300);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          if (overflow) problems.push(`${suffix} ${name}: horizontal overflow`);
          await target.scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(OUT, `${name}-${suffix}.png`), fullPage: false });
          shots++;
        };
        const step = async (name, run) => {
          try {
            await run();
          } catch (e) {
            problems.push(`${suffix} ${name}: ${String(e.message).split('\n')[0]}`);
          }
        };
        await page.goto('/admin/settings/ai');
        await card.waitFor();
        await step('defaults', async () => {
          await card.getByTestId('ai-models-agentReplies').scrollIntoViewIfNeeded();
          await shot('ai-models-defaults', card.getByTestId('ai-models-agentReplies'));
        });
        await step('unavailable', () =>
          shot('ai-models-unavailable', card.getByTestId('ai-models-translate')),
        );
        if (locale !== 'en') {
          await ctx.close();
          continue;
        }
        await step('list open', async () => {
          await card.getByTestId('ai-models-writing-select').click();
          await shot('ai-models-list', page.getByRole('listbox'));
          await page.getByRole('option', { name: /^Main model/ }).click();
        });
        await step('edited', async () => {
          await card
            .getByTestId('ai-models-writing')
            .getByRole('radio', { name: 'Smarter' })
            .click();
          await shot('ai-models-edited', card.getByTestId('ai-models-writing'));
        });
        await step('saved', async () => {
          await card.getByTestId('ai-models-save').click();
          await card.getByTestId('ai-models-writing-default').waitFor();
          await shot('ai-models-saved', card.getByTestId('ai-models-writing'));
        });
        await step('suggest note', () =>
          shot('ai-models-suggest-note', page.getByTestId('reply-suggestions-settings')),
        );
        await step('claude', async () => {
          await req('PATCH', '/api/ai/connection', {
            mode: 'claude',
            model: 'claude-sonnet-5-5',
            apiKey: 'sk-ant-demo-0000000000000000',
          });
          await page.reload();
          await card.waitFor();
          await shot('ai-models-claude', card.getByTestId('ai-models-agentReplies'));
        });
        await ctx.close();
      }
} finally {
  await browser.close();
  await stop(server);
  rmSync(data, { recursive: true, force: true });
}
console.log(JSON.stringify({ shots, problems }, null, 2));
if (problems.length) process.exitCode = 1;

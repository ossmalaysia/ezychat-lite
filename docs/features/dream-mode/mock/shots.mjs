// Screenshots of the Dream mode quick mock: every state at desktop 1280 and phone 360, light and dark.
// Run from the repo root: node docs/features/dream-mode/mock/shots.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = `${here}screens`;
mkdirSync(out, { recursive: true });
const page0 = pathToFileURL(`${here}index.html`).href;

const states = ['off', 'waiting', 'auto', 'change', 'paused'];
const sizes = { desktop: { width: 1280, height: 1000 }, phone: { width: 360, height: 760 } };

const browser = await chromium.launch({ channel: 'chrome' });
for (const theme of ['light', 'dark'])
  for (const [label, viewport] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const state of states) {
      if (theme === 'dark' && state !== 'waiting' && state !== 'change') continue;
      await page.goto(`${page0}?state=${state}&theme=${theme}`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      await page.screenshot({
        path: `${out}/${label}-${state}-${theme}.png`,
        fullPage: state !== 'change',
      });
      console.log(`${label} ${state} ${theme}${wide ? ' HORIZONTAL SCROLL' : ''}`);
    }
    if (errors.length) console.log('page errors:', errors.join(' | '));
    await page.close();
  }
await browser.close();

// Screenshots of the quick mock: every state at 1280 and 360 px, light and dark, into ./screens.
// Run from a checkout with node_modules: node docs/features/ask-ezy-setup/mock/shots.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, 'screens');
mkdirSync(out, { recursive: true });
const page0 = pathToFileURL(join(here, 'index.html')).href;

const states = ['ask', 'which', 'cards', 'applied', 'lite', 'edit', 'error'];
const sizes = [
  { name: 'desktop', width: 1280, height: 760 },
  { name: 'mobile', width: 360, height: 760 },
];
const browser = await chromium.launch();
const problems = [];
for (const size of sizes)
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    page.on('pageerror', (e) => problems.push(e.message));
    for (const state of states) {
      await page.goto(`${page0}?state=${state}&theme=${theme}`);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      if (wide) problems.push(`${state} ${size.name} ${theme}: horizontal overflow`);
      await page.screenshot({ path: join(out, `${state}-${size.name}-${theme}.png`) });
    }
    await page.close();
  }
await browser.close();
console.log(problems.length ? problems.join('\n') : `${states.length * 4} shots, no errors, no overflow`);

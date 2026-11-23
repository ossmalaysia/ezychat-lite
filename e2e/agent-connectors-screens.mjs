// Screenshots of Agent page → Connectors (the summary rows, the "· Set up" cue) and the connector page
// opened from it ("Back to AI agent" before the breadcrumb), for the screen review and
// docs/screenshots/connectors. Fresh --fake-wa server without a Google app: the fake Google signs in.
// Usage: node e2e/agent-connectors-screens.mjs <port> <outDir>
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const PORT = Number(process.argv[2] ?? 7477);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'agent-connectors-screens');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { origin: BASE, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  cookie = res.headers.get('set-cookie')?.split(';')[0] ?? cookie;
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const local = (url) => {
  const u = new URL(url, BASE);
  return `${BASE}${u.pathname}${u.search}`;
};

if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', ADMIN);
await api('POST', '/auth/login', { username: ADMIN.username, password: ADMIN.password });
const created = await api('POST', '/ai/agents', {
  displayName: 'Workshop assistant',
  enabled: false,
  preset: 'faq',
  instructions: 'Answer questions about the workshop.',
  handoffRules: '',
});
if (created.status !== 200) throw new Error(`Creating the agent failed: ${created.status}`);
const agentId = (await api('GET', '/ai/agents')).json.agents[0].id;

// Sign in to the fake Google Calendar: consent page → Allow → loopback callback.
const start = (await api('POST', '/connectors/google-calendar/connect', {})).json;
const consent = await (await fetch(local(start.authorizationUrl))).text();
const allow = /id="allow" href="([^"]+)"/.exec(consent)?.[1]?.replaceAll('&#38;', '&');
if (!allow) throw new Error('The fake Google consent page offers no Allow.');
await fetch(local(allow));
if ((await api('GET', '/connectors/google-calendar')).json.state !== 'connected')
  throw new Error('Google Calendar did not connect.');
// This agent does not use the calendar yet: the row says so and adds the Set up cue.
const rules = (await api('GET', `/connectors/google-calendar/agents/${agentId}`)).json;
await api('PUT', `/connectors/google-calendar/agents/${agentId}`, {
  ...rules,
  checkFree: false,
  book: false,
});

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
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
async function shots(stage) {
  for (const scheme of ['light', 'dark'])
    for (const [size, options] of Object.entries(sizes)) {
      const tag = `${size}${scheme === 'dark' ? '-dark' : ''}`;
      const ctx = await browser.newContext({ ...options, baseURL: BASE, colorScheme: scheme });
      const [name, value] = cookie.split('=');
      await ctx.addCookies([{ name, value, url: BASE }]);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${stage} ${tag} pageerror: ${e.message}`));
      const overflow = async (file) => {
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          )
        )
          problems.push(`${tag} ${file}: horizontal overflow`);
      };
      await page.goto(`/admin/members/ai/${agentId}`);
      const row = page.getByTestId('agent-connector-google-calendar');
      await row.waitFor();
      await page.getByText('Not used by this agent').waitFor();
      const cue = (await row.textContent()).includes('Set up');
      if (stage === 'setup' && !cue) problems.push(`${tag}: no Set up cue`);
      if (stage === 'attention' && cue) problems.push(`${tag}: Set up cue while signed out`);
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await overflow(`card-${stage}`);
      await page.screenshot({ path: join(OUT, `agent-card-${stage}-${tag}.png`) });
      if (stage === 'setup') {
        await row.click();
        await page.getByRole('link', { name: 'Back to AI agent' }).waitFor();
        await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await overflow('back-link');
        await page.screenshot({ path: join(OUT, `agent-back-link-${tag}.png`) });
        await page.getByRole('link', { name: 'Back to AI agent' }).click();
        await page.waitForURL(new RegExp(`/admin/members/ai/${agentId}$`));
      }
      await ctx.close();
    }
}
await shots('setup');
// Google needs attention: the badge shows and the Set up cue does not.
await api('POST', '/dev/fake-google-calendar', { state: 'expired' });
await shots('attention');
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Saved to ${OUT}`);

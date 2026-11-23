// Screenshots of the AI agent's name above its message linking to the agent's page (admins), for the
// screen review and docs/screenshots/chat. A fresh --fake-wa server has the AI user but no AI message,
// so the message list is answered in the browser with one AI reply; no model is ever called.
// Usage: node e2e/agent-link-screens.mjs <port> <outDir>
/* global document -- used inside page.evaluate (runs in the browser) */
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
const OUT = resolve(repo, process.argv[3] ?? 'agent-link-screens');
if (!inside(repo, OUT) && !inside(resolve(tmpdir()), OUT))
  throw new Error('The output folder must be inside the repository or the temp folder.');
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };
const AGENT = { username: 'farid', displayName: 'Farid', password: 'demo-pass-456' };
const NURUL = '60126677889@s.whatsapp.net';

async function call(method, path, body, cookie = '') {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { origin: BASE, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? cookie };
}
const login = async (u) =>
  (await call('POST', '/auth/login', { username: u.username, password: u.password })).cookie;

if ((await (await fetch(BASE + '/api/setup/status')).json()).needsSetup)
  await call('POST', '/setup/admin', ADMIN);
const admin = await login(ADMIN);
await call('POST', '/users', { ...AGENT, role: 'agent' }, admin);
const agent = await login(AGENT);
// a new member must change the starting password first
await call(
  'POST',
  '/auth/change-password',
  { currentPassword: AGENT.password, newPassword: 'demo-pass-789' },
  agent,
);
await call(
  'POST',
  '/dev/fake-incoming',
  {
    chatJid: NURUL,
    senderName: 'Nurul Huda',
    text: 'Can I order two Nasi Lemak for pickup at 1pm?',
  },
  admin,
);
const before = await (await call('GET', '/users', undefined, admin)).res.json();
if (!before.users.some((u) => u.kind === 'ai' && !u.aiDeleted)) {
  const created = await call(
    'POST',
    '/ai/agents',
    {
      displayName: 'Workshop assistant',
      enabled: false,
      preset: 'faq',
      instructions: 'Answer questions about the workshop.',
      handoffRules: '',
    },
    admin,
  );
  if (!created.res.ok)
    throw new Error(`Creating the agent failed: ${created.res.status} ${await created.res.text()}`);
}
const users = await (await call('GET', '/users', undefined, admin)).res.json();
const ai = users.users.find((u) => u.kind === 'ai' && !u.aiDeleted);
if (!ai) throw new Error('No AI user on this server.');

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
for (const [who, cookie] of [
  ['admin', admin],
  ['agent', agent],
])
  for (const scheme of ['light', 'dark'])
    for (const [size, options] of Object.entries(sizes)) {
      if (who === 'agent' && scheme === 'dark') continue;
      const tag = `${size}${scheme === 'dark' ? '-dark' : ''}`;
      const ctx = await browser.newContext({ ...options, baseURL: BASE, colorScheme: scheme });
      const [name, value] = cookie.split('=');
      await ctx.addCookies([{ name, value, url: BASE }]);
      await ctx.route(/\/api\/chats\/[^/]+\/messages\?/, async (r) => {
        const res = await r.fetch();
        const json = await res.json();
        const first = json.messages[0];
        if (first) {
          json.messages.unshift({
            ...first,
            id: 'AI-REPLY-1',
            fromMe: true,
            senderJid: null,
            senderName: null,
            sentByUserId: ai.id,
            status: 'read',
            body: 'Hi Nurul! Two Nasi Lemak Ayam (RM12 each) for pickup at 1pm. May I have your name for the order?',
            timestamp: first.timestamp + 60_000,
          });
        }
        await r.fulfill({ response: res, json });
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${who} ${tag} pageerror: ${e.message}`));
      await page.goto(`/chats/${encodeURIComponent(NURUL)}`);
      await page.getByText('May I have your name').waitFor();
      // the team directory loads after the messages: wait for it before counting links
      if (who === 'admin') await page.getByTestId('agent-link').waitFor();
      else await page.waitForLoadState('networkidle');
      const links = await page.getByTestId('agent-link').count();
      if (who === 'admin' && links !== 1)
        problems.push(`${tag}: expected the agent link, found ${links}`);
      if (who === 'agent' && links !== 0) problems.push(`${tag}: a team member sees the link`);
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        )
      )
        problems.push(`${who} ${tag}: horizontal overflow`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `agent-link-${who}-${tag}.png`) });
      if (who === 'admin' && size === 'desktop' && scheme === 'light') {
        // keyboard focus: the ring around the name is not clipped
        await page.getByTestId('agent-link').focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await page.screenshot({ path: join(OUT, `agent-link-focus-${tag}.png`) });
        await page.getByTestId('agent-link').click();
        await page.waitForURL(/\/admin\/members\/ai\/\d+/);
        await page.screenshot({ path: join(OUT, `agent-link-opened-${tag}.png`) });
      }
      await ctx.close();
    }
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Saved to ${OUT}`);

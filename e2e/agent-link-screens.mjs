// Screenshots of the AI agent's name above its message linking to the agent's page (admins), for the
// screen review and docs/screenshots/chat. A fresh --fake-wa server has the AI user but no AI message,
// so the message list is answered in the browser with one AI reply; no model is ever called.
// Usage: node e2e/agent-link-screens.mjs <port> <outDir>
/* global document -- used inside page.evaluate (runs in the browser) */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { apiClient } from './devbuild-client.mjs';

const PORT = Number(process.argv[2] ?? 7477);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error('The port must be an integer between 1024 and 65535.');
const repo = resolve(import.meta.dirname, '..');
const OUT = resolve(repo, process.argv[3] ?? 'agent-link-screens');
const within = (base) => !relative(base, OUT).startsWith('..') && !isAbsolute(relative(base, OUT));
if (!within(repo) && !within(resolve(tmpdir())))
  throw new Error('The output folder must be inside the repository or the temp folder.');
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });
const NURUL = '60126677889@s.whatsapp.net';

// The admin, a team member (who must change the starting password first) and one AI agent.
const admin = apiClient(BASE);
const member = apiClient(BASE);
const ADMIN = { username: 'aisyah', displayName: 'Aisyah', password: 'demo-pass-123' };
if ((await admin('GET', '/setup/status')).json.needsSetup)
  await admin('POST', '/setup/admin', ADMIN);
await admin('POST', '/auth/login', { username: ADMIN.username, password: ADMIN.password });
await admin('POST', '/users', {
  username: 'farid',
  displayName: 'Farid',
  password: 'demo-pass-456',
  role: 'agent',
});
await member('POST', '/auth/login', { username: 'farid', password: 'demo-pass-456' });
await member('POST', '/auth/change-password', {
  currentPassword: 'demo-pass-456',
  newPassword: 'demo-pass-789',
});
await admin('POST', '/dev/fake-incoming', {
  chatJid: NURUL,
  senderName: 'Nurul Huda',
  text: 'Can I order two Nasi Lemak for pickup at 1pm?',
});
const aiUser = async () =>
  (await admin('GET', '/users')).json.users.find((u) => u.kind === 'ai' && !u.aiDeleted);
if (!(await aiUser())) {
  const created = await admin('POST', '/ai/agents', {
    displayName: 'Workshop assistant',
    enabled: false,
    preset: 'faq',
    instructions: 'Answer questions about the workshop.',
    handoffRules: '',
  });
  if (created.status !== 200) throw new Error(`Creating the agent failed: ${created.status}`);
}
const ai = await aiUser();
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
for (const [who, client] of [
  ['admin', admin],
  ['agent', member],
])
  for (const scheme of ['light', 'dark'])
    for (const [size, options] of Object.entries(sizes)) {
      if (who === 'agent' && scheme === 'dark') continue;
      const tag = `${size}${scheme === 'dark' ? '-dark' : ''}`;
      const ctx = await browser.newContext({ ...options, baseURL: BASE, colorScheme: scheme });
      const [name, value] = client.headers().cookie.split('=');
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

// Screenshots of the AI agent's name above its message linking to the agent's page (admins), for the
// screen review and docs/screenshots/chat. A fresh --fake-wa server has no AI message, so the message
// list is answered in the browser with one AI reply; no model is ever called.
// Usage: node e2e/agent-link-screens.mjs <port> <outDir>
/* global document -- used inside page.evaluate (runs in the browser) */
import { apiClient } from './devbuild-client.mjs';
import { DEMO_ADMIN, eachScreen, launchBrowser, screensArgs, shot } from './screens-common.mjs';

const { base, out } = screensArgs('agent-link-screens');
const NURUL = '60126677889@s.whatsapp.net';

// The admin, a team member (who must change the starting password first) and one AI agent.
const admin = apiClient(base);
const member = apiClient(base);
if ((await admin('GET', '/setup/status')).json.needsSetup)
  await admin('POST', '/setup/admin', DEMO_ADMIN);
await admin('POST', '/auth/login', {
  username: DEMO_ADMIN.username,
  password: DEMO_ADMIN.password,
});
const FARID = { username: 'farid', displayName: 'Farid', password: 'demo-pass-456' };
await admin('POST', '/users', { ...FARID, role: 'agent' });
await member('POST', '/auth/login', { username: FARID.username, password: FARID.password });
await member('POST', '/auth/change-password', {
  currentPassword: FARID.password,
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

const browser = await launchBrowser();
const problems = [];
for (const [who, client] of [
  ['admin', admin],
  ['agent', member],
])
  await eachScreen(browser, base, client.headers().cookie, async (ctx, tag) => {
    // one AI reply after the customer's message, sent by the AI user
    await ctx.route(/\/api\/chats\/[^/]+\/messages\?/, async (r) => {
      const res = await r.fetch();
      const json = await res.json();
      const first = json.messages[0];
      if (first)
        json.messages.unshift({
          ...first,
          id: 'AI-REPLY-1',
          fromMe: true,
          senderJid: null,
          senderName: null,
          sentByUserId: ai.id,
          status: 'read',
          body: 'https://kopiapong.example/menu Hi Nurul! Two Nasi Lemak Ayam (RM12 each) for pickup at 1pm. May I have your name for the order?',
          timestamp: first.timestamp + 60_000,
        });
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
    await shot(page, out, problems, tag, `agent-link-${who}`);
    if (who === 'admin') {
      // The name's touch area stays in its own row: the link at the start of the reply (first text line under
      // the name) is what a tap there hits, never the agent link.
      const hit = await page.evaluate(() => {
        const url = [...document.querySelectorAll('a')].find((a) =>
          a.textContent?.includes('kopiapong.example'),
        );
        if (!url) return 'no url link';
        const r = url.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + 4, r.top + 2);
        return at?.closest('[data-testid="agent-link"]')
          ? 'agent link'
          : at?.closest('a') === url
            ? 'url'
            : 'other';
      });
      if (hit !== 'url') problems.push(`${tag}: a tap on the reply's first line hits ${hit}`);
    }
    if (who === 'admin' && tag === 'desktop') {
      // keyboard focus: the ring around the name is not clipped
      await page.getByTestId('agent-link').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await shot(page, out, problems, tag, 'agent-link-focus');
      await page.getByTestId('agent-link').click();
      await page.waitForURL(/\/admin\/members\/ai\/\d+/);
      await shot(page, out, problems, tag, 'agent-link-opened');
    }
  });
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Saved to ${out}`);

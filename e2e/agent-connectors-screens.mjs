// Screenshots of Agent page → Connectors (the summary rows, the "· Set up" cue) and the connector page
// opened from it ("Back to AI agent" before the breadcrumb), for the screen review and
// docs/screenshots/connectors. Fresh --fake-wa server; the calendar's sign-in state is answered in the browser.
// Usage: node e2e/agent-connectors-screens.mjs <port> <outDir>
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { apiClient } from './devbuild-client.mjs';
import { DEMO_ADMIN, eachScreen, launchBrowser, screensArgs, shot } from './screens-common.mjs';

const { base: BASE, out: OUT } = screensArgs('agent-connectors-screens');
const ADMIN = DEMO_ADMIN;
const api = apiClient(BASE);
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

// This agent does not use the calendar yet: the row says so and adds the Set up cue.
const rules = (await api('GET', `/connectors/google-calendar/agents/${agentId}`)).json;
const saved = await api('PUT', `/connectors/google-calendar/agents/${agentId}`, {
  ...rules,
  checkFree: false,
  book: false,
});
if (saved.status !== 200) throw new Error(`Saving the calendar settings failed: ${saved.status}`);

const browser = await launchBrowser();
const problems = [];
const shots = (stage) =>
  eachScreen(browser, BASE, api.headers().cookie, async (ctx, tag) => {
    // Google Calendar signed in (or needing attention), answered in the browser: no sign-in round trip
    await ctx.route(/\/api\/connectors\/google-calendar$/, async (r) => {
      const res = await r.fetch();
      const json = await res.json();
      const signedIn = { account: 'kopiapong@example.com', connectedAt: Date.now() - 86_400_000 };
      await r.fulfill({
        response: res,
        json:
          stage === 'setup'
            ? { ...json, ...signedIn, state: 'connected', problemSince: null }
            : { ...json, ...signedIn, state: 'expired', problemSince: Date.now() - 3_600_000 },
      });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${stage} ${tag} pageerror: ${e.message}`));
    await page.goto(`/admin/members/ai/${agentId}`);
    const row = page.getByTestId('agent-connector-google-calendar');
    await row.waitFor();
    await page.getByText('Not used by this agent').waitFor();
    const cue = (await row.textContent()).includes('Set up');
    if (stage === 'setup' && !cue) problems.push(`${tag}: no Set up cue`);
    if (stage === 'attention' && cue) problems.push(`${tag}: Set up cue while signed out`);
    await row.scrollIntoViewIfNeeded();
    await shot(page, OUT, problems, tag, `agent-card-${stage}`);
    if (stage === 'setup') {
      await row.click();
      const back = page.getByRole('link', { name: 'Back to AI agent' });
      await back.waitFor();
      await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, OUT, problems, tag, 'agent-back-link');
      await back.click();
      await page.waitForURL(new RegExp(`/admin/members/ai/${agentId}$`));
    }
  });
await shots('setup');
// Google needs attention: the badge shows and the Set up cue does not.
await shots('attention');
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Saved to ${OUT}`);

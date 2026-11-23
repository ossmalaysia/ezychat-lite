// Screenshots of Agent page → Connectors (the summary rows, the "· Set up" cue) and the connector page
// opened from it ("Back to AI agent" before the breadcrumb), for the screen review and
// docs/screenshots/connectors. Fresh --fake-wa server without a Google app: the fake Google signs in.
// Usage: node e2e/agent-connectors-screens.mjs <port> <outDir>
/* global document, window -- used inside page.evaluate (runs in the browser) */
import { apiClient } from './devbuild-client.mjs';
import { DEMO_ADMIN, eachScreen, launchBrowser, screensArgs, shot } from './screens-common.mjs';

const { base: BASE, out: OUT } = screensArgs('agent-connectors-screens');
const ADMIN = DEMO_ADMIN;
const api = apiClient(BASE);
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

const browser = await launchBrowser();
const problems = [];
const shots = (stage) =>
  eachScreen(browser, BASE, api.headers().cookie, async (ctx, tag) => {
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
await api('POST', '/dev/fake-google-calendar', { state: 'expired' });
await shots('attention');
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Saved to ${OUT}`);

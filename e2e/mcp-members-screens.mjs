// Screenshots of AI assistants for team members in the real app (docs/features/mcp-for-members), for the screen
// review against the confirmed mock: the admin switch and its turn-off dialog, members' connected apps in
// Settings → Integrations, a member's My AI assistants and Permissions, and the app sign-in page as a member.
// Run against a fresh Dev Build: `npx tsx --conditions=ezychat-source packages/server/src/cli.ts --data <tmp>
// --port <port> --mode dev --fake-wa --web-dist apps/web/dist`, then `node e2e/mcp-members-screens.mjs <port> <outDir>`.
// Nothing leaves the computer: the app sign-in is done against this server's own OAuth endpoints.
import { createHash } from 'node:crypto';
import {
  apiPost,
  eachScreen,
  launchBrowser,
  screensArgs,
  shot,
  signInDemoAdmin,
} from './screens-common.mjs';

const { base: BASE, out: OUT } = screensArgs('docs/screenshots/mcp-for-members');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(43) + '-verifier_0123456789';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const MEMBER = { username: 'daniel', displayName: 'Daniel', password: 'demo-pass-123' };

const patch = (path, body, cookie) =>
  fetch(BASE + '/api' + path, {
    method: 'PATCH',
    headers: { origin: BASE, 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

async function register(name) {
  const res = await fetch(BASE + '/mcp/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      client_name: name,
      token_endpoint_auth_method: 'none',
    }),
  });
  return (await res.json()).client_id;
}

const authParams = (clientId) => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'st-1',
  resource: `${BASE}/mcp`,
});

/** The member approves an app for themselves and the app exchanges the code: a connected app. */
async function connectApp(cookie, name, canSend) {
  const clientId = await register(name);
  const { res } = await apiPost(
    BASE,
    '/oauth/decision',
    { ...authParams(clientId), approve: true, canSend },
    cookie,
  );
  const code = new URL((await res.json()).redirectTo).searchParams.get('code');
  await fetch(BASE + '/mcp/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      resource: `${BASE}/mcp`,
    }),
  });
}

async function signInMember(adminCookie) {
  await apiPost(BASE, '/users', { ...MEMBER, role: 'agent' }, adminCookie);
  const { cookie } = await apiPost(BASE, '/auth/login', {
    username: MEMBER.username,
    password: MEMBER.password,
  });
  // A new member must change the password first; keep the same one for the demo.
  await apiPost(
    BASE,
    '/auth/change-password',
    { currentPassword: MEMBER.password, newPassword: `${MEMBER.password}!` },
    cookie,
  );
  return (
    await apiPost(BASE, '/auth/login', {
      username: MEMBER.username,
      password: `${MEMBER.password}!`,
    })
  ).cookie;
}

const admin = await signInDemoAdmin(BASE);
await patch('/integrations/mcp', { enabled: true, membersEnabled: true }, admin);
const member = await signInMember(admin);
await connectApp(member, 'Claude', true);
await connectApp(member, 'ChatGPT', false);
const pendingClient = await register('Claude');

const problems = [];
const browser = await launchBrowser();
try {
  await eachScreen(browser, BASE, admin, async (ctx, tag) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag}: ${e.message}`));
    await page.goto('/admin/settings/integrations');
    await page.getByTestId('members-switch-row').waitFor();
    await shot(page, OUT, problems, tag, 'admin-integrations');
    await page.getByTestId('token-member').first().scrollIntoViewIfNeeded();
    await shot(page, OUT, problems, tag, 'admin-member-apps');
    await page.getByRole('switch', { name: 'Members can connect AI assistants' }).click();
    await page.getByRole('alertdialog').waitFor();
    await shot(page, OUT, problems, tag, 'admin-members-off-dialog');
    await page.close();
  });
  await eachScreen(browser, BASE, member, async (ctx, tag) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag}: ${e.message}`));
    await page.goto('/account');
    const card = page.getByTestId('member-assistant');
    await card.waitFor();
    await page.getByTestId('member-token-row').first().waitFor();
    await card.scrollIntoViewIfNeeded();
    await shot(page, OUT, problems, tag, 'member-assistants');
    await page.getByRole('button', { name: 'Change what token Claude may do' }).click();
    await page.getByRole('dialog').waitFor();
    await shot(page, OUT, problems, tag, 'member-permissions');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Disconnect ChatGPT' }).click();
    await page.getByRole('alertdialog').waitFor();
    await shot(page, OUT, problems, tag, 'member-disconnect');
    await page.keyboard.press('Escape');
    await page.goto(`/oauth/authorize?${new URLSearchParams(authParams(pendingClient))}`);
    await page.getByTestId('oauth-consent').waitFor();
    await shot(page, OUT, problems, tag, 'member-approve');
    await page.getByLabel('Let it send WhatsApp messages as you').check();
    await shot(page, OUT, problems, tag, 'member-approve-send');
    await page.close();
  });
  // The members switch off: the member's card and approval page say so.
  await patch('/integrations/mcp', { membersEnabled: false }, admin);
  await eachScreen(browser, BASE, member, async (ctx, tag) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag}: ${e.message}`));
    await page.goto('/account');
    await page.getByTestId('member-assistant-off').waitFor();
    await page.getByTestId('member-assistant').scrollIntoViewIfNeeded();
    await shot(page, OUT, problems, tag, 'member-assistants-off');
    await page.goto(`/oauth/authorize?${new URLSearchParams(authParams(pendingClient))}`);
    await page.getByText('Your admin has not let members connect AI assistants.').waitFor();
    await shot(page, OUT, problems, tag, 'member-approve-off');
    await page.close();
  });
} finally {
  await browser.close();
}
console.log(problems.length ? problems.join('\n') : 'no problems');
process.exitCode = problems.length ? 1 : 0;

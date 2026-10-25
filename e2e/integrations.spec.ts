import { createHash } from 'node:crypto';
import {
  request as playwrightRequest,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { expect, expectNoHorizontalScroll, test } from './helpers';

const MCP_INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' },
  },
};

const DESKTOP = 'desktop-chromium';
const ONE_PROJECT = 'the AI assistant access switch is inbox-wide: one project drives it';

/** POST one MCP JSON-RPC request with a bearer token, without any browser cookies or Origin. */
function mcpPost(api: APIRequestContext, secret: string, data: unknown) {
  return api.post('/mcp', {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${secret}`,
    },
    data,
  });
}

async function postInitialize(api: APIRequestContext, secret: string): Promise<number> {
  return (await mcpPost(api, secret, MCP_INITIALIZE)).status();
}

/** Open Settings → Integrations with AI assistant access on; returns the switch. */
async function accessOn(page: Page) {
  await page.goto('/admin/settings/integrations');
  const access = page.getByRole('switch', { name: 'Let AI assistants read this inbox' });
  if ((await access.getAttribute('aria-checked')) !== 'true') await access.click();
  await expect(access).toHaveAttribute('aria-checked', 'true');
  return access;
}

/** Create token sits under "For developer tools" (closed by default) in the Connect card. */
async function openCreateToken(page: Page) {
  const toggle = page.getByRole('button', { name: /For developer tools/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByRole('button', { name: 'Create token', exact: true }).click();
}

/** Remove the connection through its confirm dialog, then turn the inbox-wide switch off again. */
async function revokeAndTurnOff(page: Page, name: string, access: Locator) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/settings/integrations');
  const row = page.getByTestId('api-token-row').filter({ hasText: name });
  await row.getByRole('button', { name: `Remove ${name}` }).click();
  await page
    .getByRole('alertdialog', { name: `Remove “${name}”?` })
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await access.click();
  await expect(access).toHaveAttribute('aria-checked', 'false');
}

test('admin turns on AI assistant access, creates a token, uses it on /mcp and revokes it', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== DESKTOP, ONE_PROJECT);
  await page.setViewportSize({ width: 1280, height: 900 });

  // A clean context: no admin session cookie, so only the bearer token can authorize /mcp.
  const api = await playwrightRequest.newContext({ baseURL });
  try {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/integrations$/);

    const access = page.getByRole('switch', { name: 'Let AI assistants read this inbox' });
    await expect(access).toBeVisible();
    // Off by default on a fresh data dir (a CI retry may find the state of the first attempt).
    if (info.retry === 0) await expect(access).toHaveAttribute('aria-checked', 'false');
    if ((await access.getAttribute('aria-checked')) !== 'true') await access.click();
    await expect(access).toHaveAttribute('aria-checked', 'true');

    // No tunnel runs under e2e: the page points to Phone access.
    await expect(page.getByText('No tunnel is running', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Phone access' })).toHaveAttribute(
      'href',
      '/admin/tunnel',
    );

    // Create a token with a Chinese name that never expires.
    const name = `客服助手 ${String(Date.now()).slice(-6)}`;
    await openCreateToken(page);
    const create = page.getByRole('dialog', { name: 'Create access token' });
    await expect(create).toBeVisible();
    await expect(create.getByRole('radio', { name: '90 days' })).toBeChecked();
    // An empty name is refused inline.
    await create.getByRole('button', { name: 'Create token', exact: true }).click();
    await expect(create.getByText('Enter a name.')).toBeVisible();
    await create.getByLabel('Name', { exact: true }).fill(name);
    // SegmentedControl: the visible label is the click target over its small radio.
    await create.locator('label', { hasText: /^Never$/ }).click();
    await expect(create.getByRole('radio', { name: 'Never' })).toBeChecked();
    await create.getByRole('button', { name: 'Create token', exact: true }).click();

    // The secret is shown exactly once, with ready-made client settings.
    const created = page.getByRole('dialog', { name: 'Copy your token now' });
    await expect(created).toBeVisible();
    const secret = (await created.getByTestId('api-token-secret').innerText()).trim();
    expect(secret).toMatch(/^ezc_pat_/);
    await expect(created.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const command = await created.getByTestId('mcp-snippet-claude').innerText();
    expect(command).toContain(secret);
    expect(command).toContain('/mcp');
    await created.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(created).toBeHidden();

    // The list shows only the prefix; the full secret is never on the page again.
    const row = page.getByTestId('api-token-row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${secret.slice(0, 12)}…`);
    expect(await page.locator('body').innerText()).not.toContain(secret);

    // The token works on the MCP endpoint.
    expect(await postInitialize(api, secret)).toBe(200);

    // Revoke through the confirm dialog; the token stops working at once.
    await row.getByRole('button', { name: `Remove ${name}` }).click();
    const confirm = page.getByRole('alertdialog', { name: `Remove “${name}”?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(row).toHaveCount(0);
    expect(await postInitialize(api, secret)).toBe(401);

    // Phone width: no horizontal page scroll.
    await page.setViewportSize({ width: 360, height: 780 });
    await expect(access).toBeVisible();
    await expectNoHorizontalScroll(page, 'settings/integrations 360');

    // Leave the inbox-wide switch off again for other runs.
    await access.click();
    await expect(access).toHaveAttribute('aria-checked', 'false');
  } finally {
    await api.dispose();
  }
});

test('a token that can message new numbers: badges, ban warning, and the chat the assistant started', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== DESKTOP, ONE_PROJECT);
  await page.setViewportSize({ width: 1280, height: 900 });
  const api = await playwrightRequest.newContext({ baseURL });
  try {
    const access = await accessOn(page);

    const name = `Follow-ups ${String(Date.now()).slice(-6)}`;
    await openCreateToken(page);
    const create = page.getByRole('dialog', { name: 'Create access token' });
    await create.getByLabel('Name', { exact: true }).fill(name);
    const canNew = create.getByRole('checkbox', { name: 'Can also message new numbers' });
    await expect(canNew).toHaveCount(0);
    await create.getByRole('checkbox', { name: 'Can send WhatsApp messages' }).click();
    await expect(create.getByText(/Replies go straight to your customers/)).toBeVisible();
    await canNew.click();
    await expect(create.getByText('Risk of a WhatsApp ban')).toBeVisible();
    await create.getByRole('button', { name: 'Create token', exact: true }).click();
    const created = page.getByRole('dialog', { name: 'Copy your token now' });
    const secret = (await created.getByTestId('api-token-secret').innerText()).trim();
    await created.getByRole('button', { name: 'Done', exact: true }).click();

    const row = page.getByTestId('api-token-row').filter({ hasText: name });
    await expect(row.getByText('Can send', { exact: true })).toBeVisible();
    await expect(row.getByText('New numbers', { exact: true })).toBeVisible();

    // The assistant messages a number that is not in the inbox (fake WhatsApp knows every number).
    const phone = `6019${String(Date.now()).slice(-7)}`;
    const res = await mcpPost(api, secret, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'send_to_new_number',
        arguments: {
          phone: `+${phone}`,
          text: 'Thank you for visiting our booth. Here is the menu you asked for.',
          requestId: `e2e-new-${phone}`,
        },
      },
    });
    expect(res.status()).toBe(200);
    const result = JSON.parse((await res.json()).result.content[0].text);
    expect(result).toMatchObject({ newChat: true, chatJid: `${phone}@s.whatsapp.net` });
    expect(result.warning).toMatch(/WhatsApp can ban a number/);

    // The inbox warns about the chat the assistant started and marks the message.
    await page.goto(`/chats/${encodeURIComponent(`${phone}@s.whatsapp.net`)}`);
    await expect(page.getByText('An AI assistant started this chat')).toBeVisible();
    await expect(page.getByTestId('via-assistant')).toContainText('via AI assistant');
    await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.getByText('An AI assistant started this chat')).toBeVisible();
    await expectNoHorizontalScroll(page, 'chat started by assistant 360');

    await revokeAndTurnOff(page, name, access);
  } finally {
    await api.dispose();
  }
});

test('the owner lets an existing token send, and the same token gets send_message at once', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== DESKTOP, ONE_PROJECT);
  await page.setViewportSize({ width: 1280, height: 900 });
  const api = await playwrightRequest.newContext({ baseURL });
  const tools = async (secret: string) => {
    const res = await mcpPost(api, secret, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(res.status()).toBe(200);
    return ((await res.json()).result.tools as Array<{ name: string }>).map((x) => x.name);
  };
  try {
    const access = await accessOn(page);

    const name = `Reports ${String(Date.now()).slice(-6)}`;
    await openCreateToken(page);
    const create = page.getByRole('dialog', { name: 'Create access token' });
    await create.getByLabel('Name', { exact: true }).fill(name);
    await create.getByRole('button', { name: 'Create token', exact: true }).click();
    const created = page.getByRole('dialog', { name: 'Copy your token now' });
    const secret = (await created.getByTestId('api-token-secret').innerText()).trim();
    await created.getByRole('button', { name: 'Done', exact: true }).click();
    expect(await tools(secret)).not.toContain('send_message');

    const row = page.getByTestId('api-token-row').filter({ hasText: name });
    await row.getByRole('button', { name: `Change what token ${name} may do` }).click();
    const dialog = page.getByRole('dialog', { name: `Permissions of “${name}”` });
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Can send WhatsApp messages' }).click();
    await expect(dialog.getByText(/Replies go straight to your customers/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText('Can send', { exact: true })).toBeVisible();
    expect(await tools(secret)).toContain('send_message');

    // Phone width: the token name keeps the full row, the actions sit under the details.
    await page.setViewportSize({ width: 360, height: 780 });
    await expect(
      row.getByRole('button', { name: `Change what token ${name} may do` }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, 'token permissions 360');

    await revokeAndTurnOff(page, name, access);
  } finally {
    await api.dispose();
  }
});

test('an AI app signs in with OAuth: the admin approves it on the approval page, no token copy', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== DESKTOP, ONE_PROJECT);
  await page.setViewportSize({ width: 1280, height: 900 });
  const api = await playwrightRequest.newContext({ baseURL });
  const callback = 'http://localhost:4999/callback';
  const name = `E2E Assistant ${String(Date.now()).slice(-6)}`;
  const verifier = `e2e-verifier-${'x'.repeat(40)}`;
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  try {
    const access = await accessOn(page);
    const card = page.getByTestId('connect-app-card');
    await expect(card.getByTestId('connect-app-url')).toHaveText(/\/mcp$/);

    // What claude.ai or ChatGPT does after the admin pastes the address: find the sign-in, register.
    const unauth = await api.post('/mcp', { data: MCP_INITIALIZE });
    expect(unauth.status()).toBe(401);
    expect(unauth.headers()['www-authenticate']).toContain('resource_metadata=');
    const meta = await (await api.get('/.well-known/oauth-authorization-server')).json();
    const reg = await api.post(new URL(meta.registration_endpoint).pathname, {
      data: { client_name: name, redirect_uris: [callback], token_endpoint_auth_method: 'none' },
    });
    expect(reg.status()).toBe(201);
    const clientId = (await reg.json()).client_id as string;

    // The app's redirect target is not running: answer it here and keep the URL.
    await page.route(`${callback}**`, (route) => route.fulfill({ status: 200, body: 'ok' }));
    const authorize = new URL(meta.authorization_endpoint);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: callback,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'e2e-state',
    }).toString();
    await page.goto(authorize.pathname + authorize.search);
    await expect(page.getByRole('heading', { name: `Connect ${name}?` })).toBeVisible();
    await expect(page.getByTestId('oauth-host')).toHaveText('localhost:4999');
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page, 'oauth approval 360');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForURL(`${callback}**`);
    const back = new URL(page.url());
    expect(back.searchParams.get('state')).toBe('e2e-state');

    const tokenRes = await api.post(new URL(meta.token_endpoint).pathname, {
      form: {
        grant_type: 'authorization_code',
        client_id: clientId,
        code: back.searchParams.get('code')!,
        redirect_uri: callback,
        code_verifier: verifier,
      },
    });
    expect(tokenRes.status()).toBe(200);
    const accessToken = (await tokenRes.json()).access_token as string;
    expect(await postInitialize(api, accessToken)).toBe(200);

    // The connection shows under Connected apps, marked Signed in; the admin can remove it.
    await page.goto('/admin/settings/integrations');
    const row = page.getByTestId('api-token-row').filter({ hasText: name });
    await expect(row.getByTestId('token-kind')).toHaveText('Signed in');
    await revokeAndTurnOff(page, name, access);
    expect(await postInitialize(api, accessToken)).toBe(404);
  } finally {
    await api.dispose();
  }
});

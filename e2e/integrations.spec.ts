import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
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

/** POST an MCP initialize request with a bearer token, without any browser cookies or Origin. */
async function postInitialize(api: APIRequestContext, secret: string): Promise<number> {
  const res = await api.post('/mcp', {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${secret}`,
    },
    data: MCP_INITIALIZE,
  });
  return res.status();
}

// The AI-assistant access switch is inbox-wide, so only one project drives it.
test('admin turns on AI assistant access, creates a token, uses it on /mcp and revokes it', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
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

    // No tunnel runs under e2e: the page points to the Cloudflare settings.
    await expect(page.getByText('No tunnel is running', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Cloudflare settings' })).toHaveAttribute(
      'href',
      '/admin/tunnel',
    );

    // Create a token with a Chinese name that never expires.
    const name = `客服助手 ${String(Date.now()).slice(-6)}`;
    await page.getByRole('button', { name: 'Create token', exact: true }).click();
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
    await row.getByRole('button', { name: `Revoke token ${name}` }).click();
    const confirm = page.getByRole('alertdialog', { name: `Revoke “${name}”?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Revoke token', exact: true }).click();
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

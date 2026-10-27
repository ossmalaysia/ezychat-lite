import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './helpers';

/**
 * Partner connectors from the signed TEST connector list (e2e/start-partners.mjs): the app
 * downloads the list from the partner MCP test server and connects to its endpoints with each
 * sign-in type. Runs only in the `partners` project, against its own server and data dir.
 */
const ORIGIN = 'http://127.0.0.1:7497';
const PARTNER = 'https://127.0.0.1:7611';
const ADMIN = { username: 'owner', displayName: 'Aisyah', password: 'owner-pass-123' };
// Demo values of the test server (e2e/partner-mcp/README.md).
const API_KEY = 'pk_test_kedai_4242';

test.describe.configure({ mode: 'serial' });

async function post(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.post(path, { data, headers: { Origin: ORIGIN } });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
}

/** Switches a test endpoint: ok, down (connections dropped), refused (401). */
async function partnerState(request: APIRequestContext, endpoint: string, state: string) {
  const res = await request.post(`${PARTNER}/_control`, {
    data: { endpoint, state },
    headers: { Authorization: 'Bearer e2e-partner-control' },
    ignoreHTTPSErrors: true,
  });
  expect(res.ok()).toBe(true);
}

let admin: Page;

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true })).newPage();
  await post(admin.request, '/api/setup/admin', ADMIN);
  await post(admin.request, '/api/auth/login', {
    username: ADMIN.username,
    password: ADMIN.password,
  });
  // Settings are per AI agent: one agent, off (no model is ever called here).
  await post(admin.request, '/api/ai/agents', {
    displayName: 'Sales assistant',
    enabled: false,
    preset: 'faq',
    instructions: 'Answer questions about invoices and stock.',
    handoffRules: 'Hand over refunds.',
  });
});

test('the gallery shows the downloaded list with its icons', async () => {
  await admin.goto('/admin/connectors');
  await expect(admin.getByText(/Connector list updated/)).toBeVisible({ timeout: 15_000 });
  const kedai = admin.getByTestId('connector-card-test-kedai');
  await expect(kedai).toBeVisible();
  await expect(kedai.getByText('Not connected')).toBeVisible();
  await expect(kedai.locator('img[src^="/api/connectors/icons/"]')).toBeVisible();
  // Google Calendar stays a built-in connector with its own page.
  await expect(admin.getByTestId('connector-card-google-calendar')).toBeVisible();

  await admin.getByRole('button', { name: 'Check for new connectors' }).click();
  await expect(admin.getByText('You have the newest connector list.')).toBeVisible();
});

test('API key: a wrong key is refused, the right key connects, Disconnect', async () => {
  await admin.goto('/admin/connectors/test-kedai');
  await admin.getByRole('button', { name: 'Connect with an API key' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('API key').fill('pk_wrong_key');
  await dialog.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(dialog.getByText(/refused this key/)).toBeVisible();

  await dialog.getByLabel('API key').fill(API_KEY);
  await dialog.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(dialog.getByText(/The connection works/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByText('Key ending in 4242')).toBeVisible();
  // The key itself never comes back to the page.
  await expect(admin.locator('body')).not.toContainText(API_KEY);

  // The partner goes down: Test connection says so in plain words.
  await partnerState(admin.request, 'api-key', 'down');
  await admin.getByRole('button', { name: 'Test connection' }).click();
  await expect(admin.getByText(/Could not reach|did not work/).first()).toBeVisible();
  await partnerState(admin.request, 'api-key', 'ok');
  await admin.getByRole('button', { name: 'Test connection' }).click();
  await expect(admin.getByText(/The connection works/)).toBeVisible();
});

test('settings: look-ups on, tools that change data off, rules shown, saved', async () => {
  await admin.goto('/admin/connectors/test-kedai');
  await admin.getByRole('tab', { name: 'Settings' }).click();
  await expect(admin.getByText('Rules the AI always follows')).toBeVisible();
  const lookup = admin.getByRole('switch', { name: /Find invoices|find_invoice/i }).first();
  const write = admin.getByRole('switch', { name: /quotation/i }).first();
  await expect(lookup).toBeChecked();
  await expect(write).not.toBeChecked();
  await write.click();
  await admin.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByText('Saved').first()).toBeVisible();
  await admin.reload();
  await admin.getByRole('tab', { name: 'Settings' }).click();
  await expect(admin.getByRole('switch', { name: /quotation/i }).first()).toBeChecked();
});

test('account details form: connects with the declared fields', async () => {
  await admin.goto('/admin/connectors/test-gudang');
  await admin.getByRole('button', { name: 'Connect with your account details' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Account').fill('acme');
  await dialog.getByLabel('Username').fill('demo');
  await dialog.getByLabel('Password').fill('demo-pass-9876');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByText('Connected', { exact: true }).first()).toBeVisible();
});

test('OAuth: sign in on the partner page in a new tab', async () => {
  await admin.goto('/admin/connectors/test-lejar');
  const [consent] = await Promise.all([
    admin.context().waitForEvent('page'),
    admin.getByRole('button', { name: /^Connect / }).click(),
  ]);
  await expect(admin.getByText('Waiting for you to sign in')).toBeVisible();
  await consent.waitForLoadState();
  await consent.getByRole('button', { name: 'Allow' }).click();
  await expect(admin.getByText('Connected', { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await consent.close().catch(() => undefined);
});

test('no sign-in: connects at once; the gallery lists your connectors', async () => {
  await admin.goto('/admin/connectors/test-open');
  await admin.getByRole('button', { name: /^Connect / }).click();
  await expect(admin.getByText('Connected', { exact: true }).first()).toBeVisible();

  await admin.goto('/admin/connectors');
  await expect(admin.getByRole('heading', { name: 'Your connectors' })).toBeVisible();
  for (const id of ['test-kedai', 'test-gudang', 'test-lejar', 'test-open'])
    await expect(admin.getByTestId(`connector-card-${id}`).getByText('Connected')).toBeVisible();
});

test('Disconnect keeps the agent settings', async () => {
  await admin.goto('/admin/connectors/test-kedai');
  await admin.getByRole('button', { name: 'Disconnect' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(admin.getByText('Kedai CRM (test) disconnected')).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Connect with an API key' })).toBeVisible();
});

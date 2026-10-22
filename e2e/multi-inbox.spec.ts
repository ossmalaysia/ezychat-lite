import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { chatHref, chatItem, expect, inboxHeading, signIn, test } from './helpers';

/**
 * Several WhatsApp numbers (Enterprise-style build: `--max-inboxes 3`, see e2e/start-multi-inbox.mjs).
 * Runs only in the `multi-inbox` project, against its own server and data dir.
 */
const ORIGIN = 'http://127.0.0.1:7498';
const ADMIN = { username: 'owner', displayName: 'Aisyah', password: 'owner-pass-123' };
const DANIEL = {
  username: 'daniel',
  displayName: 'Daniel',
  temp: 'daniel-temp-123',
  next: 'daniel-next-123',
};
const MEILING = {
  username: 'meiling',
  displayName: 'Mei Ling',
  temp: 'meiling-temp-123',
  next: 'meiling-next-123',
};
const CUSTOMER = `6012${String(Date.now()).slice(-7)}@s.whatsapp.net`;
const CUSTOMER_IN_CATERING = `${CUSTOMER}#2`;

test.describe.configure({ mode: 'serial' });

async function post(request: APIRequestContext, path: string, data: unknown, method = 'post') {
  const res = await request.fetch(path, { method, data, headers: { Origin: ORIGIN } });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json().catch(() => null);
}

/** First sign-in of a new agent: the forced password change, then the inbox. */
async function signInAgent(browser: Browser, agent: typeof DANIEL): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: ORIGIN })).newPage();
  await signIn(page, agent.username, agent.temp);
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Current password').fill(agent.temp);
  await page.getByLabel('New password', { exact: true }).fill(agent.next);
  await page.getByLabel('Confirm new password').fill(agent.next);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(inboxHeading(page)).toBeVisible();
  return page;
}

let admin: Page;
const userIds: Record<string, number> = {};

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext({ baseURL: ORIGIN })).newPage();
  await post(admin.request, '/api/setup/admin', ADMIN);
  await post(admin.request, '/api/auth/login', {
    username: ADMIN.username,
    password: ADMIN.password,
  });
  for (const a of [DANIEL, MEILING]) {
    const user = await post(admin.request, '/api/users', {
      username: a.username,
      displayName: a.displayName,
      role: 'agent',
      password: a.temp,
    });
    userIds[a.username] = user.id;
  }
});

test('admin adds a second number, links it, and chooses who can open it', async () => {
  await admin.goto('/admin');
  const nav = admin.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Inboxes' }).first()).toBeVisible();
  await expect(nav.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveCount(0);

  await admin.goto('/admin/inboxes');
  await admin.getByRole('button', { name: 'Add inbox' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Inbox name').fill('Catering');
  await dialog.getByLabel(MEILING.displayName).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByTestId('inbox-qr')).toBeVisible();

  // The e2e stand-in for the QR scan.
  await post(admin.request, '/api/dev/fake-link', { inboxId: 2 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  const catering = admin.getByTestId('inbox-card').filter({ hasText: 'Catering' });
  await expect(catering.getByTestId('inbox-state')).toHaveText('Connected');
  await expect(catering.getByText(MEILING.displayName)).toBeVisible();

  // Daniel only works for the first number; Mei Ling only for Catering.
  await post(admin.request, `/api/users/${userIds.daniel}/inboxes`, { inboxIds: [1] }, 'put');
  await post(admin.request, `/api/users/${userIds.meiling}/inboxes`, { inboxIds: [2] }, 'put');
});

test('one customer writing to both numbers is two chats in one list', async () => {
  await post(admin.request, '/api/dev/fake-incoming', {
    chatJid: CUSTOMER,
    text: 'Kopi order please',
    senderName: 'Ahmad',
  });
  await post(admin.request, '/api/dev/fake-incoming', {
    chatJid: CUSTOMER,
    text: 'Catering for 40 people?',
    senderName: 'Ahmad',
    inboxId: 2,
  });
  await admin.goto('/');
  await expect(chatItem(admin, CUSTOMER)).toBeVisible();
  await expect(chatItem(admin, CUSTOMER_IN_CATERING)).toBeVisible();
  await expect(
    chatItem(admin, CUSTOMER_IN_CATERING).getByText('Catering', { exact: true }),
  ).toBeVisible();

  // The inbox filter narrows the unified list.
  await admin.getByRole('combobox', { name: 'Inbox' }).click();
  await admin.getByRole('option', { name: /^Catering/ }).click();
  await expect(chatItem(admin, CUSTOMER_IN_CATERING)).toBeVisible();
  await expect(chatItem(admin, CUSTOMER)).toHaveCount(0);
  await admin.getByRole('combobox', { name: 'Inbox' }).click();
  await admin.getByRole('option', { name: /^All inboxes/ }).click();
  await expect(chatItem(admin, CUSTOMER)).toBeVisible();

  // A reply from the Catering chat leaves from the Catering number.
  await admin.goto(chatHref(CUSTOMER_IN_CATERING));
  await admin.getByPlaceholder(/Type a message/i).fill('Yes, we can do 40.');
  await admin.keyboard.press('Enter');
  // The chat list preview shows the same text: look in the conversation only.
  await expect(
    admin.getByRole('log', { name: 'Messages' }).getByText('Yes, we can do 40.'),
  ).toBeVisible();
});

test('an agent sees only the chats of their inboxes', async ({ browser }) => {
  const daniel = await signInAgent(browser, DANIEL);
  await expect(chatItem(daniel, CUSTOMER)).toBeVisible();
  await expect(chatItem(daniel, CUSTOMER_IN_CATERING)).toHaveCount(0);
  await daniel.goto(chatHref(CUSTOMER_IN_CATERING));
  await expect(daniel.getByText('This chat doesn’t exist.').first()).toBeVisible();
  await daniel.context().close();

  const meiling = await signInAgent(browser, MEILING);
  await expect(chatItem(meiling, CUSTOMER_IN_CATERING)).toBeVisible();
  await expect(chatItem(meiling, CUSTOMER)).toHaveCount(0);
  await meiling.context().close();
});

test('admin removes the second number; the first inbox cannot be removed', async () => {
  await admin.goto('/admin/inboxes');
  await expect(admin.getByRole('button', { name: /^Remove · WhatsApp$/ })).toHaveCount(0);
  await admin.getByRole('button', { name: 'Remove · Catering' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Remove inbox' }).click();
  await expect(admin.getByTestId('inbox-card').filter({ hasText: 'Catering' })).toHaveCount(0);
  const res = await admin.request.delete('/api/inboxes/1', { headers: { Origin: ORIGIN } });
  expect(res.status()).toBe(409);
});

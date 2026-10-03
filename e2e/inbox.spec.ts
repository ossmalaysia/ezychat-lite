import type { Page } from '@playwright/test';
import {
  QUICK_REPLY,
  chatItem,
  expect,
  test,
  customerJid,
  fakeIncoming,
  inboxHeading,
} from './helpers';

function messages(page: Page) {
  return page.getByRole('log', { name: 'Messages' });
}

async function backToList(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: 'Back to chats' });
  if (await back.isVisible()) await back.click();
  await expect(inboxHeading(page)).toBeVisible();
}

async function showStatus(page: Page, status: 'Open' | 'Resolved'): Promise<void> {
  const tab = page.getByRole('tab', { name: status, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('inbox', () => {
  test('incoming → assign → reply → resolve → reopened by new message', async ({
    page,
    baseURL,
  }, info) => {
    const jid = customerJid(info, 1);
    await page.goto('/');
    await expect(inboxHeading(page)).toBeVisible();
    await showStatus(page, 'Open');
    await page.getByRole('tab', { name: 'All' }).click();

    // Realtime: the chat shows up in the already-open list with an unread badge.
    await fakeIncoming(
      page,
      { chatJid: jid, text: 'Hi, need help', senderName: 'Customer' },
      baseURL!,
    );
    const item = chatItem(page, jid);
    await expect(item).toBeVisible();
    await expect(item).toContainText('Hi, need help');
    await expect(item.getByLabel('1 unread')).toBeVisible();

    // Open the conversation.
    await item.click();
    await expect(messages(page).getByText('Hi, need help')).toBeVisible();

    // Assign to me.
    const assign = page.getByRole('combobox', { name: 'Assigned to' });
    await assign.click();
    await page.getByRole('option', { name: 'Admin (you)' }).click();
    await expect(assign).toHaveText('Admin (you)');

    // Reply.
    const composer = page.getByLabel('Message', { exact: true });
    await composer.fill('Hello!');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer).toHaveValue('');
    await expect(messages(page).getByText('Hello!', { exact: true })).toBeVisible();
    await expect(
      messages(page).getByRole('img', { name: /^(Sent|Delivered|Read)$/ }),
    ).toBeVisible();

    // Resolve.
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();

    // Appears under the Resolved filter, not under Open.
    await backToList(page);
    await expect(item).toBeHidden();
    await showStatus(page, 'Resolved');
    await expect(item).toBeVisible();

    // A new incoming message reopens the chat.
    await fakeIncoming(
      page,
      { chatJid: jid, text: 'Are you there?', senderName: 'Customer' },
      baseURL!,
    );
    await expect(item).toBeHidden();
    await showStatus(page, 'Open');
    await expect(item).toBeVisible();
    await expect(item).toContainText('Are you there?');
  });

  test('quick reply /hi can be inserted from the composer', async ({ page, baseURL }, info) => {
    const jid = customerJid(info, 2);
    await page.goto('/');
    await expect(inboxHeading(page)).toBeVisible();
    await fakeIncoming(
      page,
      { chatJid: jid, text: 'Hello?', senderName: 'Quick Customer' },
      baseURL!,
    );

    await page.goto(`/chats/${encodeURIComponent(jid)}`);
    await expect(messages(page).getByText('Hello?', { exact: true })).toBeVisible();

    const composer = page.getByLabel('Message', { exact: true });
    await composer.fill(`/${QUICK_REPLY.shortcut}`);
    const option = page.getByRole('option', { name: new RegExp(`/${QUICK_REPLY.shortcut}\\b`) });
    await expect(option).toBeVisible();
    await option.click();
    await expect(composer).toHaveValue(QUICK_REPLY.body);

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer).toHaveValue('');
    await expect(messages(page).getByText(QUICK_REPLY.body, { exact: true })).toBeVisible();
  });
});

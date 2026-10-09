import { chatItem, customerJid, expect, fakeIncoming, inboxHeading, test } from './helpers';

test('reply to a specific customer message: Reply button, reply bar, quoted bubble', async ({
  page,
  baseURL,
}, info) => {
  // Hover is the desktop entry point; touch swipe and long-press are covered by unit tests.
  test.skip(info.project.name !== 'desktop-chromium');
  const jid = customerJid(info, 51);
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(
    page,
    { chatJid: jid, text: 'Do you deliver to Butterworth?', senderName: 'Koh' },
    baseURL!,
  );
  await fakeIncoming(
    page,
    { chatJid: jid, text: 'We prefer online transfer', senderName: 'Koh' },
    baseURL!,
  );
  await chatItem(page, jid).click();

  const log = page.getByRole('log', { name: 'Messages' });
  const first = log.locator('[data-message-id]', { hasText: 'Do you deliver to Butterworth?' });
  await first.hover();
  await first.locator('..').getByRole('button', { name: 'Reply' }).click();

  const bar = page.getByTestId('reply-bar');
  await expect(bar).toContainText('Replying to Koh');
  await expect(bar).toContainText('Do you deliver to Butterworth?');
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeFocused();
  await composer.fill('Yes, Butterworth is RM15.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(bar).toBeHidden();
  const sent = log.locator('[data-message-id]', { hasText: 'Yes, Butterworth is RM15.' });
  await expect(sent).toContainText('Do you deliver to Butterworth?');
  await expect(sent.getByRole('img', { name: /^(Sent|Delivered|Read)$/ })).toBeVisible();

  // The stored reply points at the customer's message (what WhatsApp quotes).
  const res = await page.request.get(`/api/chats/${encodeURIComponent(jid)}/messages`);
  const body = (await res.json()) as {
    messages: Array<{ id: string; body: string | null; quotedId: string | null }>;
  };
  const original = body.messages.find((m) => m.body === 'Do you deliver to Butterworth?');
  const reply = body.messages.find((m) => m.body === 'Yes, Butterworth is RM15.');
  expect(reply?.quotedId).toBe(original?.id);

  // Esc cancels a reply before sending.
  const second = log.locator('[data-message-id]', { hasText: 'We prefer online transfer' });
  await second.hover();
  await second.locator('..').getByRole('button', { name: 'Reply' }).click();
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
});

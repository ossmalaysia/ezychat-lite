import { chatItem, customerJid, expect, fakeIncoming, inboxHeading, test } from './helpers';

/** A message with WhatsApp formatting looks as it does in the WhatsApp app: marks hidden, text formatted. */
test('shows WhatsApp formatting in the bubble and plain text in the chat list', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 61);
  const text = [
    'We are an *OpenAI Select Partner* and pay _upfront_.',
    'Old price ~RM 120~ now RM 99.',
    '> Quote from the brochure',
    '* Standard seats',
    '- Annual plan',
    'Order code `ABC-123` and 2 * 3 * 4 stays as typed.',
  ].join('\n');
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(page, { chatJid: jid, text, senderName: 'Khairul' }, baseURL!);

  // The chat list preview hides the marks too.
  await expect(chatItem(page, jid)).toContainText('We are an OpenAI Select Partner');
  await chatItem(page, jid).click();

  const bubble = page
    .getByRole('log', { name: 'Messages' })
    .locator('[data-message-id]', { hasText: 'Select Partner' });
  await expect(bubble.locator('strong', { hasText: 'OpenAI Select Partner' })).toBeVisible();
  await expect(bubble.locator('em', { hasText: 'upfront' })).toBeVisible();
  await expect(bubble.locator('s', { hasText: 'RM 120' })).toBeVisible();
  await expect(bubble.locator('[data-quote]')).toHaveText('Quote from the brochure');
  await expect(bubble.locator('[data-bullet]')).toHaveText(['Standard seats', 'Annual plan']);
  await expect(bubble.locator('code', { hasText: 'ABC-123' })).toBeVisible();
  await expect(bubble).not.toContainText('*OpenAI');
  await expect(bubble).toContainText('2 * 3 * 4 stays as typed');
  await bubble.screenshot({ path: info.outputPath('whatsapp-format.png') });
});

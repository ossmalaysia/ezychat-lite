import {
  chatHref,
  chatItem,
  customerJid,
  expect,
  fakeIncoming,
  inboxHeading,
  projectTag,
  test,
} from './helpers';

test('customer profile: edit in the chat, live name + tag in the inbox, filter by tag', async ({
  page,
  context,
  baseURL,
}, info) => {
  const jid = customerJid(info, 41);
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(
    page,
    { chatJid: jid, text: 'Hi, catering for 30?', senderName: 'Farah 🌸' },
    baseURL!,
  );

  // A second tab stays on the inbox list (also on phones, where an open chat hides the list).
  const inbox = await context.newPage();
  await inbox.goto('/');
  await inbox.getByRole('tab', { name: 'All' }).click();
  await expect(chatItem(inbox, jid)).toContainText('Farah 🌸');

  await page.goto(chatHref(jid));
  await page.getByRole('button', { name: 'Customer details' }).click();
  // Desktop: an aside next to the chat; phones: a sheet (dialog).
  const panel = page
    .getByRole('complementary', { name: 'Customer' })
    .or(page.getByRole('dialog', { name: 'Customer' }));
  // Desktop, panel beside the chat: the header still shows the customer's name, not one squeezed
  // letter. (On phones the panel is a modal sheet over the header.)
  await expect(panel).toBeVisible();
  if (await page.getByRole('complementary', { name: 'Customer' }).isVisible()) {
    const title = page.getByRole('heading', { level: 2 }).first().locator('span[title]');
    const clipped = await title.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, 'customer name is truncated in the chat header').toBe(false);
  }
  await panel.getByRole('button', { name: 'Add details' }).click();
  await panel.getByLabel('Name').fill('Farah Aziz');
  await panel.getByLabel('Company').fill('Farah Catering Co');
  const tags = panel.getByRole('combobox');
  await tags.fill('VIP');
  await tags.press('Enter');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('region', { name: 'From WhatsApp' })).toContainText('Farah 🌸');
  await expect(panel.getByText('Farah Catering Co')).toBeVisible();

  // Live in the other tab: the profile name and the tag chip.
  await expect(chatItem(inbox, jid)).toContainText('Farah Aziz');
  await expect(chatItem(inbox, jid)).toContainText('VIP');

  // Filter by tag.
  await inbox.getByRole('button', { name: 'Filter by tag' }).click();
  await inbox.getByRole('option', { name: 'VIP' }).click();
  await expect(chatItem(inbox, jid)).toBeVisible();

  // Search finds the company.
  await inbox.getByRole('button', { name: 'Clear tag filter' }).click();
  await inbox.getByRole('searchbox').fill('Catering Co');
  await expect(chatItem(inbox, jid)).toBeVisible();
  await inbox.getByRole('searchbox').fill('');

  // A brand-new tag added in the chat tab is offered at once by the other tab's Tag filter (whose
  // tag list was already loaded above) and filters the list to that customer.
  const tag = `Hungry${projectTag(info)}`;
  await panel.getByRole('button', { name: 'Edit' }).click();
  await panel.getByRole('combobox').fill(tag);
  await panel.getByRole('combobox').press('Enter');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(chatItem(inbox, jid)).toContainText(tag);
  await inbox.getByRole('button', { name: 'Filter by tag' }).click();
  await inbox.getByRole('option', { name: tag }).click();
  await expect(chatItem(inbox, jid)).toBeVisible();
  await expect(inbox.locator('a[href^="/chats/"]')).toHaveCount(1);
});

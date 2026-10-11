import {
  chatHref,
  expect,
  expectNoHorizontalScroll,
  inboxHeading,
  projectTag,
  test,
} from './helpers';

test('group info: members from WhatsApp, search, details and starting a chat', async ({
  page,
  baseURL,
}, info) => {
  // One group per project so desktop and phone runs never share state.
  const tag = projectTag(info).replace(/\D/g, '').padStart(2, '0').slice(-2);
  const groupJid = `1203630777000${tag}@g.us`;
  const origin = { Origin: new URL(baseURL!).origin };
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  const res = await page.request.post('/api/dev/fake-group', {
    headers: origin,
    data: {
      groupJid,
      name: 'SME Founders',
      generated: 140,
      members: [
        {
          phone: `601622144${tag}`,
          name: 'Oyen Jarvis',
          role: 'admin',
          about: 'Using WhatsApp Business',
        },
        { lid: `18439201773${tag}51` },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  await page.request.post('/api/dev/fake-incoming', {
    headers: origin,
    data: { chatJid: groupJid, text: 'Meeting Friday 8pm', senderName: 'Oyen Jarvis' },
  });

  await page.goto(chatHref(groupJid));
  // Tapping the group name opens Group info (no separate button).
  await page.getByRole('button', { name: 'Open group info for SME Founders' }).click();
  const panel = page
    .getByRole('complementary', { name: 'Group info' })
    .or(page.getByRole('dialog', { name: 'Group info' }));
  await expect(panel).toBeVisible();
  await expect(panel.getByText('143 members · 4 admins')).toBeVisible();
  const list = panel.getByRole('list', { name: 'Group members' });
  await expect(list.getByRole('listitem')).toHaveCount(100);
  await panel.getByRole('button', { name: 'Show more (100 of 143)' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(143);
  await expectNoHorizontalScroll(page, 'group info');

  await panel.getByRole('searchbox', { name: 'Search members' }).fill('oyen');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await list.getByRole('button', { name: /Oyen Jarvis/ }).click();
  await expect(panel.getByText('Using WhatsApp Business')).toBeVisible();
  await panel.getByRole('button', { name: 'Members' }).click();

  // A member without a chat: asks first, then opens a new empty chat (nothing is sent).
  await panel.getByRole('searchbox', { name: 'Search members' }).fill(`18439201773${tag}`);
  await list.getByRole('button', { name: /Number hidden by WhatsApp/ }).click();
  await panel.getByRole('button', { name: 'Message' }).click();
  const confirm = panel.getByRole('alertdialog');
  await expect(confirm).toContainText('Unsolicited messages can get your WhatsApp number banned');
  await confirm.getByRole('button', { name: 'Start chat' }).click();
  await expect(page).toHaveURL(new RegExp(`/chats/18439201773${tag}51%40lid$`));
});

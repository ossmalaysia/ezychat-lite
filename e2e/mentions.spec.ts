import {
  chatHref,
  chatItem,
  expect,
  expectNoHorizontalScroll,
  inboxHeading,
  projectTag,
  test,
} from './helpers';

test('group mentions name known people in old messages, new text, captions and quotes', async ({
  page,
  baseURL,
}, info) => {
  const tag = projectTag(info);
  const groupJid = `1203630777999${tag}@g.us`;
  const jay = `26908837493567${tag}@lid`;
  const kevin = `11502363662346${tag}@lid`;
  const origin = { Origin: new URL(baseURL!).origin };
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  const incoming = async (data: Record<string, unknown>) => {
    const r = await page.request.post('/api/dev/fake-incoming', {
      headers: origin,
      data: { chatJid: groupJid, senderJid: '111@lid', senderName: 'Alex Goh', ...data },
    });
    expect(r.status(), await r.text()).toBe(200);
    return r.json() as Promise<{ id: string }>;
  };
  const legacy = await incoming({ text: `Morning @${jay.split('@')[0]}, can you help?` });
  await incoming({ text: 'Ok', senderJid: jay, senderName: 'Jay Low', mentionedJids: [] });
  await incoming({
    text: 'Confirmed',
    senderJid: kevin,
    senderName: 'kevintho123',
    mentionedJids: [],
  });
  const explicit = await incoming({
    text: `Thanks @${kevin.split('@')[0]}`,
    mentionedJids: [kevin],
  });
  const caption = await incoming({
    text: `For @${jay.split('@')[0]}`,
    type: 'image',
    mentionedJids: [jay],
  });
  const literal = await incoming({ text: `Literal @${jay.split('@')[0]}`, mentionedJids: [] });
  await page.goto(chatHref(groupJid));
  const bubble = (id: string) => page.locator(`[data-message-id="${id}"]`);
  await expect(bubble(legacy.id)).toContainText('Morning @Jay Low, can you help?');
  await expect(bubble(explicit.id)).toContainText('Thanks @kevintho123');
  await expect(bubble(caption.id)).toContainText('For @Jay Low');
  await expect(bubble(literal.id)).toContainText(`Literal @${jay.split('@')[0]}`);
  await expectNoHorizontalScroll(page, 'group mention names');
  // Live Socket.IO presentation uses the same names, and survives a fresh page load.
  const live = await incoming({
    text: `Please check @${jay.split('@')[0]} and @${kevin.split('@')[0]}`,
    mentionedJids: [jay, kevin],
  });
  await expect(bubble(live.id)).toContainText('Please check @Jay Low and @kevintho123');
  await expect(chatItem(page, groupJid)).toContainText('Please check @Jay Low and @kevintho123');
  await page.reload();
  await expect(bubble(live.id)).toContainText('Please check @Jay Low and @kevintho123');
  const reply = await page.request.post(`/api/chats/${encodeURIComponent(groupJid)}/messages`, {
    headers: origin,
    data: { text: 'Review noted', clientId: `mention-quote-${tag}`, quotedId: legacy.id },
  });
  expect(reply.status(), await reply.text()).toBe(201);
  await expect(page.getByText('Morning @Jay Low, can you help?', { exact: true })).toHaveCount(2);
});

test('a teammate tags group members from the composer and the sent message names them', async ({
  page,
  baseURL,
}, info) => {
  const tag = projectTag(info).replace(/\D/g, '').padStart(2, '0').slice(-2);
  const groupJid = `1203630888000${tag}@g.us`;
  const farah = `601231100${tag}`;
  const origin = { Origin: new URL(baseURL!).origin };
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  const group = await page.request.post('/api/dev/fake-group', {
    headers: origin,
    data: {
      groupJid,
      name: 'Kopi Lovers Club',
      members: [
        { phone: `601266778${tag}`, name: 'Nurul Huda', role: 'admin' },
        { phone: farah, name: 'Farah Aziz' },
        { lid: `26908837493${tag}76`, name: 'Tan Wei Jie' },
      ],
    },
  });
  expect(group.status(), await group.text()).toBe(200);
  await page.request.post('/api/dev/fake-incoming', {
    headers: origin,
    data: { chatJid: groupJid, text: 'Beans arrive Friday?', senderName: 'Nurul Huda' },
  });

  await page.goto(chatHref(groupJid));
  const box = page.getByLabel('Message', { exact: true });
  await box.click();
  await box.pressSequentially('Morning @');
  const picker = page.getByTestId('mention-picker');
  await expect(picker.getByRole('option')).toHaveCount(3);
  await expect(picker.getByRole('option', { name: /Nurul Huda/ })).toContainText('Admin');
  await expectNoHorizontalScroll(page, 'mention picker');
  await box.pressSequentially('fa');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await picker.getByRole('option', { name: /Farah Aziz/ }).click();
  await box.pressSequentially('and @wei');
  await page.keyboard.press('Tab');
  await box.pressSequentially('yes, Friday');
  await expect(box).toHaveValue('Morning @Farah Aziz and @Tan Wei Jie yes, Friday');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const sent = 'Morning @Farah Aziz and @Tan Wei Jie yes, Friday';
  const log = page.getByRole('log', { name: 'Messages' });
  await expect(log.getByText(sent, { exact: true })).toBeVisible();
  // The chat list preview names them too.
  await expect(chatItem(page, groupJid)).toContainText(sent);
  // The server stored WhatsApp's form with the tags, and names them on every read.
  const list = await page.request.get(`/api/chats/${encodeURIComponent(groupJid)}/messages`);
  const messages = ((await list.json()) as { messages: { body: string | null; fromMe: boolean }[] })
    .messages;
  expect(messages.filter((m) => m.fromMe).map((m) => m.body)).toEqual([sent]);
  await page.reload();
  await expect(log.getByText(sent, { exact: true })).toBeVisible();
  await expect(log.getByText(`@${farah}`)).toHaveCount(0);
});

import {
  chatHref,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  inboxHeading,
  projectTag,
  test,
} from './helpers';

test('emoji reactions show live under the bubble, group by emoji, list who reacted and go away when removed', async ({
  page,
  baseURL,
}, info) => {
  const tag = projectTag(info);
  const jid = customerJid(info, 41);
  const groupJid = `1203630555${tag}${String(Date.now()).slice(-6)}@g.us`;
  const origin = { Origin: new URL(baseURL!).origin };
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  const incoming = async (data: Record<string, unknown>) => {
    const r = await page.request.post('/api/dev/fake-incoming', { headers: origin, data });
    expect(r.status(), await r.text()).toBe(200);
    return r.json() as Promise<{ id: string }>;
  };
  const react = async (data: Record<string, unknown>) => {
    const r = await page.request.post('/api/dev/fake-reaction', { headers: origin, data });
    expect(r.status(), await r.text()).toBe(200);
  };

  // Direct chat: the customer reacts to an outbound reply, then changes and removes it.
  const question = await incoming({
    chatJid: jid,
    senderName: 'Farah Reacts',
    text: 'Can I book catering?',
  });
  await page.goto(chatHref(jid));
  const reply = await page.request.post(`/api/chats/${encodeURIComponent(jid)}/messages`, {
    headers: origin,
    data: { text: 'Yes, Saturday works.', clientId: `reaction-reply-${tag}-${Date.now()}` },
  });
  expect(reply.status(), await reply.text()).toBe(201);
  const outbound = page.locator('[data-message-id]').filter({ hasText: 'Yes, Saturday works.' });
  await expect(outbound).toBeVisible();
  // Wait until the fake phone has given the reply its WhatsApp id (no longer `local-…`).
  await expect(outbound).not.toHaveAttribute('data-message-id', /^local-/);
  const outboundId = (await outbound.getAttribute('data-message-id'))!;
  const inbound = page.locator(`[data-message-id="${question.id}"]`);

  await react({ messageId: outboundId, emoji: '👍' });
  const badge = outbound.getByTestId('reaction-badges');
  await expect(badge).toHaveText('👍');
  await expect(badge).toHaveAccessibleName('Reactions: 👍 1');
  // The badge hangs under the bubble's corner and never covers the time or the ticks.
  const badgeBox = (await badge.boundingBox())!;
  const timeBox = (await outbound.locator('time').boundingBox())!;
  expect(badgeBox.y).toBeGreaterThanOrEqual(timeBox.y + timeBox.height);
  await react({ messageId: outboundId, emoji: '❤️' });
  await expect(badge).toHaveText('❤️');
  // The linked phone reacts to the customer's question too.
  await react({ messageId: question.id, emoji: '🙏', fromMe: true });
  await inbound.getByTestId('reaction-badges').click();
  await expect(page.getByTestId('reaction-list')).toContainText('You (phone)');
  await page.keyboard.press('Escape');
  await react({ messageId: outboundId, emoji: '' });
  await expect(badge).toHaveCount(0);
  await expectNoHorizontalScroll(page, 'direct chat reactions');

  // Group: several people, grouped with a count; a long name in the list; survives a reload.
  const groupMessage = await incoming({
    chatJid: groupJid,
    senderJid: `6011${tag}0000001@s.whatsapp.net`,
    senderName: 'Alex Goh',
    text: 'Is the durian cendol back this weekend?',
  });
  const long = 'Muhammad Hafiz bin Abdul Rahman Shah (Kopi Apong Butterworth branch)';
  const members = [
    ['👍', 'Nurul Huda'],
    ['👍', long],
    ['👍', 'Jason Lim'],
    ['❤️', 'Priya Nair'],
    ['😂', 'Tan Wei Jie'],
    ['😮', 'Ahmad Zulkifli'],
  ] as const;
  for (const [i, [emoji, name]] of members.entries())
    await react({
      messageId: groupMessage.id,
      emoji,
      senderJid: `6012${tag}00000${i}@s.whatsapp.net`,
      senderName: name,
    });
  await page.goto(chatHref(groupJid));
  const groupBadge = page
    .locator(`[data-message-id="${groupMessage.id}"]`)
    .getByTestId('reaction-badges');
  await expect(groupBadge).toHaveText('👍❤️😂6');
  await page.reload();
  await expect(groupBadge).toHaveText('👍❤️😂6');
  await groupBadge.click();
  const list = page.getByTestId('reaction-list');
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await expect(list).toContainText(long);
  await expectNoHorizontalScroll(page, 'group reactions list');
});

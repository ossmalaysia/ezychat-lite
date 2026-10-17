import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WaIncomingMessage } from '@ezychat/wa';
import { makeTestApp, type TestApp } from './helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { createMessageService } from '../src/messages/service.js';
import { createUserAndLogin, authHeaders } from './auth-helpers.js';
import { MessageListResponse, type Message } from '@ezychat/shared';

const GROUP = '120363000000001@g.us';
const JAY = '269088374935676@lid';
const KEVIN = '115023636623468@lid';
let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

async function incoming(id: string, body: string, extra: Partial<WaIncomingMessage> = {}) {
  return getMessages(t.ctx).ingest(
    {
      id,
      chatJid: GROUP,
      senderJid: '111@lid',
      senderName: 'Alex Goh',
      fromMe: false,
      type: 'text',
      body,
      quotedId: null,
      timestamp: Date.now(),
      media: null,
      ...extra,
    },
    'history',
  );
}
const list = () => getMessages(t.ctx).list(GROUP, { limit: 50 }).messages;

describe('group mention names', () => {
  it('shows known group senders in old mentions while retaining the original stored text', async () => {
    await incoming(
      'alex',
      `Morning @${JAY.split('@')[0]}, Kevin confirmed with @${KEVIN.split('@')[0]}.`,
    );
    await incoming('jay', 'Ok', { senderJid: JAY, senderName: 'Jay Low' });
    await incoming('kevin', 'Confirmed', { senderJid: KEVIN, senderName: 'kevintho123' });
    expect(list().find((m) => m.id === 'alex')?.body).toBe(
      'Morning @Jay Low, Kevin confirmed with @kevintho123.',
    );
    expect(t.ctx.db.prepare('SELECT body FROM messages WHERE id = ?').get('alex')).toEqual({
      body: `Morning @${JAY.split('@')[0]}, Kevin confirmed with @${KEVIN.split('@')[0]}.`,
    });
  });

  it('persists explicit mentions for text, phone-sent messages and media captions across a service restart', async () => {
    getChats(t.ctx).upsertContacts([{ jid: JAY, pushName: 'Jay Low', savedName: null }]);
    const events: Message[] = [];
    t.ctx.bus.on('message:new', (m) => events.push(m));
    for (const [id, type, fromMe] of [
      ['text', 'text', false],
      ['caption', 'image', false],
      ['phone', 'text', true],
    ] as const) {
      const result = await incoming(id, `Hi @${JAY.split('@')[0]}`, {
        type,
        fromMe,
        mentionedJids: [JAY],
        quotedId: id === 'caption' ? 'text' : null,
      });
      expect(result?.body).toBe('Hi @Jay Low');
      expect(events.find((m) => m.id === id)?.body).toBe('Hi @Jay Low');
    }
    expect(
      t.ctx.db.prepare('SELECT mentioned_jids FROM messages WHERE id = ?').get('text'),
    ).toEqual({ mentioned_jids: JSON.stringify([JAY]) });
    getMessages(t.ctx).shutdown();
    t.ctx.services.messages = createMessageService(t.ctx);
    expect(list().map((m) => m.body)).toEqual(['Hi @Jay Low', 'Hi @Jay Low', 'Hi @Jay Low']);
    expect(list().find((m) => m.id === 'caption')?.quotedId).toBe('text');
  });

  it('resolves a LID mention using a verified phone contact, preferring its saved name', async () => {
    getChats(t.ctx).upsertContacts([
      { jid: '60123@s.whatsapp.net', pushName: 'Jay WA', savedName: 'Jay Low', aliases: [JAY] },
    ]);
    const result = await incoming('alias', `Hi @${JAY.split('@')[0]} and @60123`, {
      mentionedJids: [JAY],
    });
    expect(result?.body).toBe('Hi @Jay Low and @Jay Low');
  });

  it('learns the group sender alternate identity before resolving mentions', async () => {
    await incoming('jay-pn', 'Ok', {
      senderJid: '60123@s.whatsapp.net',
      senderJidAlt: JAY,
      senderName: 'Jay Low',
    });
    expect(
      (await incoming('tag', `Hi @${JAY.split('@')[0]}`, { mentionedJids: [JAY] }))?.body,
    ).toBe('Hi @Jay Low');
  });

  it('uses names learned after ingest on the next authenticated message read', async () => {
    const { cookie } = await createUserAndLogin(t);
    const body = `Hi @${JAY.split('@')[0]}`;
    expect((await incoming('unknown', body, { mentionedJids: [JAY] }))?.body).toBe(body);
    getChats(t.ctx).upsertContacts([{ jid: JAY, pushName: 'Jay Low', savedName: null }]);
    const r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${encodeURIComponent(GROUP)}/messages`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(MessageListResponse.parse(r.json()).messages[0]?.body).toBe('Hi @Jay Low');
  });

  it('refreshes the latest chat preview when a mention name is learned after ingestion', async () => {
    const { cookie, user } = await createUserAndLogin(t);
    const body = `Morning @${JAY.split('@')[0]}`;
    await incoming('preview', body, { mentionedJids: [JAY] });
    expect(getChats(t.ctx).get(GROUP)?.lastMessagePreview).toBe(body);
    getChats(t.ctx).upsertContacts([{ jid: JAY, pushName: 'Jay Low', savedName: null }]);
    expect(getChats(t.ctx).get(GROUP)?.lastMessagePreview).toBe('Morning @Jay Low');
    expect(
      getChats(t.ctx)
        .list({ limit: 50, assigned: 'any' }, user.id)
        .chats.find((c) => c.jid === GROUP)?.lastMessagePreview,
    ).toBe('Morning @Jay Low');
    const r = await t.app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } });
    expect(r.json().chats.find((c: { jid: string }) => c.jid === GROUP).lastMessagePreview).toBe(
      'Morning @Jay Low',
    );
  });

  it('names mentions in live chat events and the preview used for push notifications', async () => {
    getChats(t.ctx).upsertContacts([{ jid: JAY, pushName: 'Jay Low', savedName: null }]);
    const previews: Array<string | null> = [];
    t.ctx.bus.on('inbound:notify', ({ chat }) => previews.push(chat.lastMessagePreview));
    t.ctx.bus.on('chat:updated', (chat) => previews.push(chat.lastMessagePreview));
    await getMessages(t.ctx).ingest(
      {
        id: 'live-preview',
        chatJid: GROUP,
        senderJid: '111@lid',
        senderName: 'Alex Goh',
        fromMe: false,
        type: 'image',
        body: `For @${JAY.split('@')[0]}`,
        mentionedJids: [JAY],
        quotedId: null,
        timestamp: Date.now(),
        media: null,
      },
      'live',
    );
    expect(previews).toEqual(['[Image] For @Jay Low', '[Image] For @Jay Low']);
  });

  it.each([
    ['explicit empty metadata', GROUP, []],
    ['a different explicit mention', GROUP, [KEVIN]],
    ['old direct-chat text', '60111@s.whatsapp.net', undefined],
  ])('keeps numeric text unchanged for %s', async (_scenario, chatJid, mentionedJids) => {
    getChats(t.ctx).upsertContacts([{ jid: JAY, pushName: 'Jay Low', savedName: null }]);
    const body = `Hi @${JAY.split('@')[0]}`;
    expect((await incoming('literal', body, { chatJid, mentionedJids }))?.body).toBe(body);
  });

  it('does not replace emails, URLs, usernames, bare numbers or numeric prefixes', async () => {
    getChats(t.ctx).upsertContacts([{ jid: '123@lid', pushName: 'Jay Low', savedName: null }]);
    const literal = 'alex@123.test https://example.test/@123?q=@123 @123abc @1234 @123_thing 123';
    expect(
      (await incoming('boundaries', `${literal}\n(@123), @123!`, { mentionedJids: ['123@lid'] }))
        ?.body,
    ).toBe(`${literal}\n(@Jay Low), @Jay Low!`);
  });

  it('leaves ambiguous old tags unchanged but uses the namespace in explicit metadata', async () => {
    getChats(t.ctx).upsertContacts([
      { jid: '123@lid', pushName: 'Jay Low', savedName: null },
      { jid: '123@s.whatsapp.net', pushName: 'Other person', savedName: null },
    ]);
    expect((await incoming('ambiguous', 'Hi @123'))?.body).toBe('Hi @123');
    expect((await incoming('explicit', 'Hi @123', { mentionedJids: ['123@lid'] }))?.body).toBe(
      'Hi @Jay Low',
    );
  });

  it('never copies a recycled phone number name to the new LID owner', async () => {
    getChats(t.ctx).upsertContacts([
      { jid: '60123@s.whatsapp.net', pushName: 'Old owner', savedName: null, aliases: [JAY] },
    ]);
    getChats(t.ctx).upsertContactAliases([{ jid: '60123@s.whatsapp.net', alias: KEVIN }]);
    const body = `Hi @${KEVIN.split('@')[0]} and @60123`;
    expect(
      (await incoming('moved', body, { mentionedJids: [KEVIN, '60123@s.whatsapp.net'] }))?.body,
    ).toBe(body);
    getChats(t.ctx).upsertContacts([{ jid: KEVIN, pushName: 'Kevin', savedName: null }]);
    expect(list().find((m) => m.id === 'moved')?.body).toBe('Hi @Kevin and @60123');
  });

  it('prefers a saved customer profile and treats numeric fallback names as unknown', async () => {
    await incoming('known', 'Ok', { chatJid: JAY, senderJid: JAY, senderName: 'Jay WA' });
    const { user } = await createUserAndLogin(t);
    t.ctx.services.customers!.save(
      JAY,
      { name: 'Jay Low', company: '', email: '', otherPhone: '', address: '', tags: [] },
      { userId: user.id, ip: null },
    );
    getChats(t.ctx).upsertContacts([
      { jid: KEVIN, pushName: KEVIN.split('@')[0]!, savedName: null },
    ]);
    expect(
      (
        await incoming('profile', `Hi @${JAY.split('@')[0]} and @${KEVIN.split('@')[0]}`, {
          mentionedJids: [JAY, KEVIN],
        })
      )?.body,
    ).toBe(`Hi @Jay Low and @${KEVIN.split('@')[0]}`);
  });

  it('does not treat newly composed literal numeric tags as WhatsApp mentions', async () => {
    const { user } = await createUserAndLogin(t);
    await incoming('seed', 'Ok', { senderJid: JAY, senderName: 'Jay Low' });
    t.wa.setConnected(false);
    const body = `Hi @${JAY.split('@')[0]}`;
    expect(
      getMessages(t.ctx).sendText(GROUP, { text: body, clientId: 'literal' }, user.id).body,
    ).toBe(body);
    expect(list().find((m) => m.clientId === 'literal')?.body).toBe(body);
  });

  it('simulates explicit mentions through the dev endpoint without waiting for unmodified text', async () => {
    const { cookie } = await createUserAndLogin(t);
    getChats(t.ctx).upsertContacts([{ jid: JAY, pushName: 'Jay Low', savedName: null }]);
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/dev/fake-incoming',
      headers: authHeaders(cookie),
      payload: {
        chatJid: GROUP,
        senderJid: '111@lid',
        senderName: 'Alex Goh',
        text: `Hi @${JAY.split('@')[0]}`,
        mentionedJids: [JAY],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().chatJid).toBe(GROUP);
    expect(list().find((m) => m.id === r.json().id)?.body).toBe('Hi @Jay Low');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { FakeWaAdapter, LINKED_PHONE_CAPABILITIES } from '@ezychat/wa';
import { InboxListResponse } from '@ezychat/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { createMessageService } from '../src/messages/service.js';
import { outgoingMentions } from '../src/messages/mentions.js';
import { createUserAndLogin, authHeaders } from './auth-helpers.js';

const GROUP = '120363000000001@g.us';
const DM = '60111222333@s.whatsapp.net';
const JAY = '269088374935676@lid';
const MEI = '60123456789@s.whatsapp.net';
const enc = encodeURIComponent;

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seedChats() {
  for (const [chatJid, senderJid, id] of [
    [GROUP, JAY, 'g1'],
    [DM, null, 'd1'],
  ] as const) {
    await getMessages(t.ctx).ingest(
      {
        id,
        chatJid,
        senderJid,
        senderName: 'Jay Low',
        fromMe: false,
        type: 'text',
        body: 'Hello',
        quotedId: null,
        timestamp: Date.now(),
        media: null,
      },
      'live',
    );
  }
  getChats(t.ctx).upsertContacts([
    { jid: JAY, pushName: 'Jay Low', savedName: null },
    { jid: MEI, pushName: 'Mei Ling', savedName: null },
  ]);
}

async function send(cookie: string, chatJid: string, payload: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url: `/api/chats/${enc(chatJid)}/messages`,
    headers: authHeaders(cookie),
    payload,
  });
}

describe('tagging group members in a sent message', () => {
  it('sends the tags to WhatsApp, names them in the bubble and keeps them across a restart', async () => {
    t = await makeTestApp();
    await seedChats();
    const { cookie } = await createUserAndLogin(t);
    const text = `Hi @${JAY.split('@')[0]} and @${MEI.split('@')[0]}, the slides are ready`;
    const r = await send(cookie, GROUP, {
      text,
      clientId: 'tag-1',
      mentions: [JAY, `${MEI.split('@')[0]}:12@s.whatsapp.net`, JAY],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().body).toBe('Hi @Jay Low and @Mei Ling, the slides are ready');

    await waitFor(() => t.wa.sent.length === 1);
    // WhatsApp gets the original text and each member once, in a normal address form.
    expect(t.wa.sent[0]).toMatchObject({ chatJid: GROUP, text, mentions: [JAY, MEI] });
    expect(
      t.ctx.db
        .prepare('SELECT body, mentioned_jids FROM messages WHERE client_id = ?')
        .get('tag-1'),
    ).toEqual({ body: text, mentioned_jids: JSON.stringify([JAY, MEI]) });

    getMessages(t.ctx).shutdown();
    t.ctx.services.messages = createMessageService(t.ctx);
    const sent = getMessages(t.ctx)
      .list(GROUP, { limit: 10 })
      .messages.find((m) => m.clientId === 'tag-1');
    expect(sent?.body).toBe('Hi @Jay Low and @Mei Ling, the slides are ready');
  });

  it('sends a tagged message that waited for WhatsApp to reconnect', async () => {
    t = await makeTestApp();
    await seedChats();
    const { cookie } = await createUserAndLogin(t);
    t.wa.setConnected(false);
    const text = `@${JAY.split('@')[0]} please check`;
    expect(
      (await send(cookie, GROUP, { text, clientId: 'tag-2', mentions: [JAY] })).statusCode,
    ).toBe(201);
    t.wa.setConnected(true);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]).toMatchObject({ text, mentions: [JAY] });
  });

  it('sends a message without tags exactly as before (no mentions option)', async () => {
    t = await makeTestApp();
    await seedChats();
    const { cookie } = await createUserAndLogin(t);
    expect((await send(cookie, GROUP, { text: 'Plain', clientId: 'plain' })).statusCode).toBe(201);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.mentions).toBeUndefined();
  });

  it.each([
    ['a direct chat', DM, { mentions: [JAY] }, /only group messages/],
    ['an address that is not a person', GROUP, { mentions: [GROUP] }, /not a WhatsApp address/],
    ['a member the text does not tag', GROUP, { mentions: [MEI] }, /no @tag/],
  ])('refuses tags in %s (400) and sends nothing', async (_name, chatJid, extra, error) => {
    t = await makeTestApp();
    await seedChats();
    const { cookie } = await createUserAndLogin(t);
    const r = await send(cookie, chatJid, {
      text: `Hi @${JAY.split('@')[0]}`,
      clientId: `bad-${String(_name).length}`,
      ...extra,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(error);
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE from_me = 1').get()).toEqual({
      n: 0,
    });
  });

  it('refuses tags (400) on a connection that cannot send mentions, and reports it to the web', async () => {
    const { mentions: _mentions, ...withoutMentions } = LINKED_PHONE_CAPABILITIES;
    t = await makeTestApp({ wa: new FakeWaAdapter({ capabilities: withoutMentions }) });
    await seedChats();
    const { cookie } = await createUserAndLogin(t);
    const r = await send(cookie, GROUP, {
      text: `Hi @${JAY.split('@')[0]}`,
      clientId: 'cap',
      mentions: [JAY],
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/cannot tag members/);

    const list = await t.app.inject({
      method: 'GET',
      url: '/api/inboxes',
      headers: authHeaders(cookie),
    });
    expect(InboxListResponse.parse(list.json()).inboxes[0]!.capabilities.mentions).toBe(false);
  });

  it('tells the web that a linked phone can tag members', async () => {
    t = await makeTestApp();
    const { cookie } = await createUserAndLogin(t);
    const list = await t.app.inject({
      method: 'GET',
      url: '/api/inboxes',
      headers: authHeaders(cookie),
    });
    expect(InboxListResponse.parse(list.json()).inboxes[0]!.capabilities.mentions).toBe(true);
  });
});

describe('outgoingMentions', () => {
  it('accepts whole @number tags only, never a number inside a word, email or link', () => {
    expect(outgoingMentions('Hi @60123456789!', [MEI])).toEqual([MEI]);
    for (const text of [
      'mail a@60123456789',
      'see https://x.test/@60123456789',
      'Hi @601234567890',
      'Hi 60123456789',
    ]) {
      expect(() => outgoingMentions(text, [MEI])).toThrow(/no @tag/);
    }
  });
});

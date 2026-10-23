import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MessageListResponse,
  MessageReactionsPayload,
  type Message,
  type MessageReaction,
} from '@ezychat/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getAliases } from '../src/chats/aliases.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { OWN_REACTOR, ReactionRepo, reactionRow } from '../src/messages/reactions.js';

const enc = encodeURIComponent;
const DM = '60177777777@s.whatsapp.net';
const GROUP = '120363000000001@g.us';
const ALI = '60111111111@s.whatsapp.net';
const ALI_LID = '900111@lid';
const BEN = '60122222222@s.whatsapp.net';

let t: TestApp;
let cookie: string;
let events: MessageReactionsPayload[];
let notified: number;
let created: Message[];

beforeEach(async () => {
  t = await makeTestApp();
  cookie = (await createUserAndLogin(t, { role: 'admin' })).cookie;
  events = [];
  notified = 0;
  created = [];
  t.ctx.bus.on('message:reactions', (p) => events.push(p));
  t.ctx.bus.on('inbound:notify', () => notified++);
  t.ctx.bus.on('message:new', (m) => created.push(m));
});
afterEach(async () => {
  await t.close();
});

async function incoming(chatJid: string, id: string, extra: Partial<Message> = {}) {
  return getMessages(t.ctx).ingest(
    {
      id,
      chatJid,
      senderJid: chatJid.endsWith('@g.us') ? ALI : chatJid,
      senderName: 'Gus',
      fromMe: false,
      type: 'text',
      body: `body ${id}`,
      quotedId: null,
      timestamp: 1_700_000_000_000,
      media: null,
      ...(extra as object),
    },
    'live',
  );
}

async function list(chatJid: string): Promise<Message[]> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/chats/${enc(chatJid)}/messages`,
    headers: authHeaders(cookie),
  });
  expect(res.statusCode).toBe(200);
  return MessageListResponse.parse(res.json()).messages;
}

const emojis = (rs: MessageReaction[]) => rs.map((r) => r.emoji);

describe('message reactions', () => {
  it('a customer reacts, changes and removes a reaction: live event, list, no notification', async () => {
    await incoming(DM, 'M1');
    const unreadBefore = getChats(t.ctx).get(DM)!.unreadCount;
    const createdBefore = created.length;
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '👍', timestamp: 10 });
    expect(events).toHaveLength(1);
    expect(MessageReactionsPayload.parse(events[0])).toEqual({
      chatJid: DM,
      messageId: 'M1',
      reactions: [
        {
          emoji: '👍',
          senderJid: DM,
          senderName: 'Gus',
          fromMe: false,
          at: 10,
          sentByUserId: null,
        },
      ],
    });
    expect((await list(DM))[0]!.reactions).toEqual(events[0]!.reactions);

    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '❤️', timestamp: 20 });
    expect(emojis(events[1]!.reactions)).toEqual(['❤️']);
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '', timestamp: 30 });
    expect(events[2]!.reactions).toEqual([]);
    expect((await list(DM))[0]!.reactions).toEqual([]);

    // Reactions never notify, never bump unread and never create messages.
    expect(notified).toBe(1); // the message itself
    expect(created).toHaveLength(createdBefore);
    expect(getChats(t.ctx).get(DM)!.unreadCount).toBe(unreadBefore);
  });

  it('the linked number reacts to an outbound or inbound message (fromMe)', async () => {
    await incoming(DM, 'M1');
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '🙏', fromMe: true });
    expect(events[0]!.reactions).toEqual([
      expect.objectContaining({ emoji: '🙏', fromMe: true, senderJid: null, senderName: null }),
    ]);
  });

  it('a reaction before its message waits and shows with the message', async () => {
    t.wa.simulateReaction({ chatJid: DM, targetId: 'LATE', emoji: '😂', timestamp: 5 });
    expect(events).toEqual([]);
    const msg = await incoming(DM, 'LATE');
    expect(emojis(msg!.reactions)).toEqual(['😂']);
    expect(emojis(created.at(-1)!.reactions)).toEqual(['😂']);
  });

  it('an older (history) reaction or removal never undoes a newer one; replays change nothing', async () => {
    await incoming(DM, 'M1');
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '❤️', timestamp: 100 });
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '👍', timestamp: 50 }, 'history');
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '', timestamp: 60 }, 'history');
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '❤️', timestamp: 100 });
    expect(events).toHaveLength(1);
    expect(emojis((await list(DM))[0]!.reactions)).toEqual(['❤️']);
    // Removing a reaction nobody made changes nothing.
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '', senderJid: BEN });
    expect(events).toHaveLength(1);
  });

  it('a reaction delivered in another chat never shows on the message', async () => {
    await incoming(DM, 'M1');
    t.wa.simulateReaction({ chatJid: BEN, targetId: 'M1', emoji: '👍' });
    expect(events[0]!.reactions).toEqual([]);
    expect((await list(DM))[0]!.reactions).toEqual([]);
  });

  it('group: one reaction per person, oldest first, named from contacts, profiles or WhatsApp', async () => {
    await incoming(GROUP, 'G1', { senderName: 'Ali' });
    getChats(t.ctx).upsertContacts([{ jid: BEN, pushName: 'Ben WA', savedName: 'Ben Saved' }]);
    t.wa.simulateReaction({
      chatJid: GROUP,
      targetId: 'G1',
      emoji: '👍',
      senderJid: ALI,
      senderName: 'Ali from WhatsApp',
      timestamp: 1,
    });
    t.wa.simulateReaction({
      chatJid: GROUP,
      targetId: 'G1',
      emoji: '👍',
      senderJid: BEN,
      timestamp: 2,
    });
    t.wa.simulateReaction({
      chatJid: GROUP,
      targetId: 'G1',
      emoji: '❤️',
      fromMe: true,
      timestamp: 3,
    });
    const shown = (await list(GROUP))[0]!.reactions;
    expect(shown.map((r) => [r.emoji, r.senderName, r.fromMe])).toEqual([
      ['👍', 'Ali', false], // the contact name stored from Ali's message wins
      ['👍', 'Ben Saved', false],
      ['❤️', null, true],
    ]);
  });

  it('group: a person reacting by phone number and then by WhatsApp ID stays one reactor', async () => {
    await incoming(GROUP, 'G1');
    t.wa.simulateReaction({
      chatJid: GROUP,
      targetId: 'G1',
      emoji: '👍',
      senderJid: ALI_LID,
      senderJidAlt: ALI,
      timestamp: 1,
    });
    t.wa.simulateReaction({
      chatJid: GROUP,
      targetId: 'G1',
      emoji: '😮',
      senderJid: ALI,
      timestamp: 2,
    });
    const shown = (await list(GROUP))[0]!.reactions;
    expect(shown).toEqual([expect.objectContaining({ emoji: '😮', senderJid: ALI_LID })]);
  });

  it('a direct-chat reaction teaches the explicit phone/WhatsApp ID pair, like a message', async () => {
    await incoming(DM, 'M1');
    t.wa.simulateReaction({
      chatJid: '900777@lid',
      chatJidAlt: DM,
      targetId: 'M1',
      emoji: '👍',
      timestamp: 3,
    });
    expect(getAliases(t.ctx).resolve(DM)).toBe('900777@lid');
    // Delivered under the WhatsApp ID, the reaction still belongs to the phone-number chat.
    expect(emojis((await list(DM))[0]!.reactions)).toEqual(['👍']);
  });

  it('a customer profile name wins over the WhatsApp name', async () => {
    await incoming(DM, 'M1');
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/chats/${enc(DM)}/profile`,
      headers: authHeaders(cookie),
      payload: { name: 'Gustavo (VIP)', tags: [] },
    });
    expect(res.statusCode).toBe(200);
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '👍' });
    expect(events[0]!.reactions[0]!.senderName).toBe('Gustavo (VIP)');
  });

  it('multi-inbox: a reaction attaches to the message of its own inbox only', async () => {
    await t.close();
    t = await makeTestApp({ maxInboxes: 2, inboxes: 2 });
    cookie = (await createUserAndLogin(t, { role: 'admin' })).cookie;
    events = [];
    t.ctx.bus.on('message:reactions', (p) => events.push(p));
    await getMessages(t.ctx).ingest(
      {
        id: 'SAME',
        chatJid: DM,
        senderJid: DM,
        senderName: null,
        fromMe: false,
        type: 'text',
        body: 'one',
        quotedId: null,
        timestamp: 1,
        media: null,
      },
      'live',
      2,
    );
    t.inboxWa(2).simulateReaction({ chatJid: DM, targetId: 'SAME', emoji: '👍' });
    expect(events).toEqual([expect.objectContaining({ chatJid: `${DM}#2`, messageId: 'SAME#2' })]);
    expect((await list(`${DM}#2`))[0]!.reactions).toHaveLength(1);
  });
});

describe('POST /api/dev/fake-reaction', () => {
  const post = (payload: unknown) =>
    t.app.inject({
      method: 'POST',
      url: '/api/dev/fake-reaction',
      headers: authHeaders(cookie),
      payload: payload as object,
    });

  it('reacts to a stored message as its chat partner, the phone or a group member', async () => {
    await incoming(DM, 'M1');
    await incoming(GROUP, 'G1');
    const res = await post({ messageId: 'M1', emoji: '👍' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ messageId: 'M1', chatJid: DM });
    expect((await post({ messageId: 'M1', emoji: '❤️', fromMe: true })).statusCode).toBe(200);
    expect(
      (await post({ messageId: 'G1', emoji: '😂', senderJid: BEN, senderName: 'Ben' })).statusCode,
    ).toBe(200);
    expect(emojis((await list(DM))[0]!.reactions)).toEqual(['👍', '❤️']);
    expect((await list(GROUP))[0]!.reactions[0]).toMatchObject({ emoji: '😂', senderName: 'Ben' });
  });

  it('refuses an unknown message and a group reaction without a member', async () => {
    await incoming(GROUP, 'G1');
    expect((await post({ messageId: 'NOPE', emoji: '👍' })).statusCode).toBe(404);
    expect((await post({ messageId: 'G1', emoji: '👍' })).statusCode).toBe(400);
    expect((await post({ emoji: '👍' })).statusCode).toBe(400);
  });
});

describe('ReactionRepo and reactionRow', () => {
  const aliases = { resolve: (j: string) => (j === ALI ? ALI_LID : j) };

  it('maps the reactor through the alias store; the linked number is one reactor', () => {
    const base = {
      targetId: 'X',
      chatJid: GROUP,
      senderJidAlt: null,
      senderName: '  ',
      emoji: '👍',
      timestamp: 1,
    };
    expect(reactionRow({ ...base, senderJid: ALI, fromMe: false }, 'X', aliases)).toMatchObject({
      reactor: ALI_LID,
      sender_jid: ALI_LID,
      sender_name: null,
      from_me: 0,
    });
    expect(reactionRow({ ...base, senderJid: null, fromMe: true }, 'X', aliases)).toMatchObject({
      reactor: OWN_REACTOR,
      sender_jid: null,
      from_me: 1,
    });
    expect(reactionRow({ ...base, senderJid: 'bad', fromMe: false }, 'X', aliases)).toBeNull();
    expect(
      reactionRow({ ...base, senderJid: ALI, fromMe: false, emoji: ' ' }, 'X', aliases)?.emoji,
    ).toBe('');
  });

  it('keeps a known name when a later change arrives without one; batches many ids', () => {
    const repo = new ReactionRepo(t.ctx.db);
    const row = {
      message_id: 'X',
      reactor: ALI,
      chat_wa_jid: GROUP,
      emoji: '👍',
      sender_jid: ALI,
      sender_name: 'Ali',
      from_me: 0,
      reacted_at: 1,
      sent_by_user_id: null,
    };
    expect(repo.apply(row)).toBe(true);
    expect(repo.apply({ ...row, sender_name: null })).toBe(false);
    expect(repo.apply({ ...row, emoji: '❤️', sender_name: null, reacted_at: 2 })).toBe(true);
    expect(repo.get('X', ALI)).toMatchObject({ emoji: '❤️', sender_name: 'Ali' });
    const ids = Array.from({ length: 600 }, (_, i) => `ID${i}`);
    for (const id of ['ID0', 'ID599']) repo.apply({ ...row, message_id: id });
    expect([...repo.forMessages([...ids, 'ID0']).keys()].sort()).toEqual(['ID0', 'ID599']);
  });
});

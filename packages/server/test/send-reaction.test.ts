import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MessageListResponse,
  SendReactionResponse,
  type Message,
  type MessageReactionsPayload,
} from '@ezychat/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getMessages } from '../src/wa-bridge/index.js';
import { REACTIONS_PER_MINUTE } from '../src/routes/messages.js';

const enc = encodeURIComponent;
const DM = '60177777777@s.whatsapp.net';
const DM_LID = '900777@lid';
const GROUP = '120363000000001@g.us';
const ALI = '60111111111@s.whatsapp.net';

let t: TestApp;
let admin: { cookie: string; id: number };
let events: MessageReactionsPayload[];

beforeEach(async () => {
  t = await makeTestApp();
  const a = await createUserAndLogin(t, { role: 'admin' });
  admin = { cookie: a.cookie, id: a.user.id };
  events = [];
  t.ctx.bus.on('message:reactions', (p) => events.push(p));
});
afterEach(async () => {
  await t.close();
});

async function incoming(chatJid: string, id: string, extra: Record<string, unknown> = {}) {
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
      ...extra,
    },
    'live',
  );
}

const react = (id: string, emoji: string, cookie = admin.cookie) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/messages/${enc(id)}/reaction`,
    headers: authHeaders(cookie),
    payload: { emoji },
  });

async function list(chatJid: string): Promise<Message[]> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/chats/${enc(chatJid)}/messages`,
    headers: authHeaders(admin.cookie),
  });
  return MessageListResponse.parse(res.json()).messages;
}

describe('PUT /api/messages/:id/reaction', () => {
  it('reacts as the linked number, names the teammate, replaces and removes', async () => {
    await incoming(DM, 'M1');
    const res = await react('M1', '👍');
    expect(res.statusCode).toBe(200);
    const body = SendReactionResponse.parse(res.json());
    expect(body).toEqual({
      messageId: 'M1',
      reactions: [
        expect.objectContaining({
          emoji: '👍',
          fromMe: true,
          sentByUserId: admin.id,
          senderJid: null,
        }),
      ],
    });
    expect(t.wa.reactions).toEqual([
      { chatJid: DM, target: { id: 'M1', fromMe: false, participant: null }, emoji: '👍' },
    ]);
    // WhatsApp's echo first (no teammate), then the teammate's name: the last event is complete.
    expect(events.at(-1)!.reactions).toEqual(body.reactions);
    expect((await list(DM))[0]!.reactions).toEqual(body.reactions);

    // Another teammate's emoji replaces it (one reaction per number).
    const other = await createUserAndLogin(t, { role: 'agent' });
    const replaced = SendReactionResponse.parse((await react('M1', '❤️', other.cookie)).json());
    expect(replaced.reactions).toEqual([
      expect.objectContaining({ emoji: '❤️', sentByUserId: other.user.id }),
    ]);

    const removed = await react('M1', '');
    expect(SendReactionResponse.parse(removed.json()).reactions).toEqual([]);
    expect(t.wa.reactions.at(-1)!.emoji).toBe('');
    expect(events.at(-1)!.reactions).toEqual([]);
  });

  it('a reaction made on the phone afterwards is no longer the teammate’s', async () => {
    await incoming(DM, 'M1');
    await react('M1', '👍');
    t.wa.simulateReaction({
      chatJid: DM,
      targetId: 'M1',
      emoji: '🙏',
      fromMe: true,
      timestamp: Date.now() + 1000,
    });
    expect((await list(DM))[0]!.reactions).toEqual([
      expect.objectContaining({ emoji: '🙏', fromMe: true, sentByUserId: null }),
    ]);
  });

  it('keeps the customer’s own reaction beside the linked number’s', async () => {
    await incoming(DM, 'M1');
    t.wa.simulateReaction({ chatJid: DM, targetId: 'M1', emoji: '😂', timestamp: 1 });
    const body = SendReactionResponse.parse((await react('M1', '👍')).json());
    expect(body.reactions.map((r) => [r.emoji, r.fromMe])).toEqual([
      ['😂', false],
      ['👍', true],
    ]);
  });

  it('group: points at the message author; own outbound messages need no author', async () => {
    await incoming(GROUP, 'G1');
    await incoming(GROUP, 'G2', { fromMe: true, senderJid: null });
    expect((await react('G1', '😮')).statusCode).toBe(200);
    expect((await react('G2', '🙏')).statusCode).toBe(200);
    expect(t.wa.reactions.map((r) => r.target)).toEqual([
      { id: 'G1', fromMe: false, participant: ALI },
      { id: 'G2', fromMe: true, participant: null },
    ]);
  });

  it('goes to the address the message arrived on (WhatsApp ID chat)', async () => {
    await incoming(DM_LID, 'L1', { chatJidAlt: DM });
    await react('L1', '👍');
    expect(t.wa.reactions[0]!.chatJid).toBe(DM_LID);
  });

  it('refuses a bad emoji, an unknown or unsent message, and WhatsApp offline', async () => {
    await incoming(DM, 'M1');
    for (const bad of ['hi', '👍 ', '1', '👍a', 'x'.repeat(40)])
      expect((await react('M1', bad)).statusCode, bad).toBe(400);
    expect((await react('NOPE', '👍')).statusCode).toBe(404);

    // A message still waiting to be sent has only its local id.
    t.wa.setConnected(false);
    const sent = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(DM)}/messages`,
      headers: authHeaders(admin.cookie),
      payload: { text: 'later', clientId: 'c-1' },
    });
    expect(sent.statusCode).toBe(201);
    expect((await react('local-c-1', '👍')).statusCode).toBe(400);

    const offline = await react('M1', '👍');
    expect(offline.statusCode).toBe(503);
    expect(offline.json().error.code).toBe('wa_unavailable');
    expect(t.wa.reactions).toEqual([]);
    expect(events).toEqual([]);
  });

  it('a send failure stores nothing', async () => {
    await incoming(DM, 'M1');
    t.wa.failNextSend(new Error('boom'));
    expect((await react('M1', '👍')).statusCode).toBe(500);
    expect((await list(DM))[0]!.reactions).toEqual([]);
  });

  it('needs a signed-in user', async () => {
    await incoming(DM, 'M1');
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/messages/M1/reaction',
      payload: { emoji: '👍' },
    });
    expect(res.statusCode).toBe(401);
  });

  it(`allows ${REACTIONS_PER_MINUTE} reactions a minute per user`, async () => {
    await incoming(DM, 'M1');
    for (let i = 0; i < REACTIONS_PER_MINUTE; i++)
      expect((await react('M1', i % 2 ? '👍' : '❤️')).statusCode).toBe(200);
    const limited = await react('M1', '😂');
    expect(limited.statusCode).toBe(429);
    expect(t.wa.reactions).toHaveLength(REACTIONS_PER_MINUTE);
  });
});

describe('PUT /api/messages/:id/reaction with several inboxes', () => {
  beforeEach(async () => {
    await t.close();
    t = await makeTestApp({ maxInboxes: 2, inboxes: 2 });
    const a = await createUserAndLogin(t, { role: 'admin' });
    admin = { cookie: a.cookie, id: a.user.id };
    await getMessages(t.ctx).ingest(
      {
        id: 'SAME',
        chatJid: DM,
        senderJid: DM,
        senderName: null,
        fromMe: false,
        type: 'text',
        body: 'two',
        quotedId: null,
        timestamp: 1,
        media: null,
      },
      'live',
      2,
    );
  });

  it('sends through the message’s own inbox', async () => {
    expect((await react('SAME#2', '👍')).statusCode).toBe(200);
    expect(t.inboxWa(2).reactions).toEqual([
      { chatJid: DM, target: { id: 'SAME', fromMe: false, participant: null }, emoji: '👍' },
    ]);
    expect(t.wa.reactions).toEqual([]);
  });

  it('answers 404 outside the caller’s inboxes and 409 on a removed inbox', async () => {
    const agent = await createUserAndLogin(t, { role: 'agent' });
    expect((await react('SAME#2', '👍', agent.cookie)).statusCode).toBe(404);

    await t.ctx.inboxes.connections.remove(2);
    t.ctx.inboxes.repo.markRemoved(2, Date.now());
    const res = await react('SAME#2', '👍');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('inbox_removed');
  });
});

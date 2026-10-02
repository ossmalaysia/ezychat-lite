import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChatDetailResponse, ChatListResponse, ChatSchema, NoteSchema } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const enc = encodeURIComponent;

async function seedChat(jid: string, name: string, ts: number) {
  await getMessages(t.ctx).ingest(
    {
      id: `seed-${jid}`,
      chatJid: jid,
      senderJid: jid,
      senderName: name,
      fromMe: false,
      type: 'text',
      body: `hi from ${name}`,
      quotedId: null,
      timestamp: ts,
      media: null,
    },
    'live',
  );
}

describe('chats routes', () => {
  it('requires auth', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/chats' });
    expect(r.statusCode).toBe(401);
  });

  it('lists with filters mine/none/any, status, search and cursor paging', async () => {
    const { user, cookie } = await createUserAndLogin(t, { role: 'agent' });
    const base = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) await seedChat(`6011100000${i}@s.whatsapp.net`, `Person${i}`, base + i * 1000);
    await seedChat('1203630@g.us', 'Group Chat', base + 10_000);
    getChats(t.ctx).patch('60111000001@s.whatsapp.net', { assignedTo: user.id }, user.id);
    getChats(t.ctx).patch('60111000002@s.whatsapp.net', { status: 'resolved' }, user.id);

    const list = async (qs: string) => {
      const r = await t.app.inject({ method: 'GET', url: `/api/chats?${qs}`, headers: { cookie } });
      expect(r.statusCode).toBe(200);
      return ChatListResponse.parse(r.json());
    };

    const all = await list('');
    expect(all.chats.length).toBe(6);
    expect(all.chats[0]!.jid).toBe('1203630@g.us'); // newest first
    expect((await list('assigned=me')).chats.map((c) => c.jid)).toEqual(['60111000001@s.whatsapp.net']);
    expect((await list('assigned=none')).chats.length).toBe(5);
    expect((await list('status=resolved')).chats.map((c) => c.jid)).toEqual(['60111000002@s.whatsapp.net']);
    expect((await list('status=open')).chats.length).toBe(5);
    expect((await list('q=person3')).chats.map((c) => c.jid)).toEqual(['60111000003@s.whatsapp.net']);
    expect((await list('q=1203630')).chats.length).toBe(1);

    const p1 = await list('limit=4');
    expect(p1.chats.length).toBe(4);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await list(`limit=4&cursor=${p1.nextCursor}`);
    expect(p2.chats.length).toBe(2);
    expect(p2.nextCursor).toBeNull();
    const seen = new Set([...p1.chats, ...p2.chats].map((c) => c.jid));
    expect(seen.size).toBe(6);
  });

  it('GET detail, PATCH assign writes an event, unassign + resolve too', async () => {
    const { user, cookie } = await createUserAndLogin(t, { role: 'agent' });
    const jid = '60122222222@s.whatsapp.net';
    await seedChat(jid, 'Bob', Date.now());

    let r = await t.app.inject({ method: 'GET', url: `/api/chats/${enc(jid)}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(ChatDetailResponse.parse(r.json()).events).toEqual([]);

    r = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(jid)}`,
      headers: authHeaders(cookie),
      payload: { assignedTo: user.id },
    });
    expect(r.statusCode).toBe(200);
    expect(ChatSchema.parse(r.json()).assignedTo).toBe(user.id);

    r = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(jid)}`,
      headers: authHeaders(cookie),
      payload: { assignedTo: null, status: 'resolved' },
    });
    expect(r.statusCode).toBe(200);

    r = await t.app.inject({ method: 'GET', url: `/api/chats/${enc(jid)}`, headers: { cookie } });
    const detail = ChatDetailResponse.parse(r.json());
    expect(detail.events.map((e) => e.type)).toEqual(['assigned', 'unassigned', 'resolved']);
    expect(detail.events[0]!.actorId).toBe(user.id);
    expect(detail.chat.status).toBe('resolved');
  });

  it('PATCH with unknown assignee → 400; unknown chat → 404', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const jid = '60133333333@s.whatsapp.net';
    await seedChat(jid, 'Cara', Date.now());
    let r = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(jid)}`,
      headers: authHeaders(cookie),
      payload: { assignedTo: 9999 },
    });
    expect(r.statusCode).toBe(400);
    r = await t.app.inject({ method: 'GET', url: `/api/chats/${enc('nope@s.whatsapp.net')}`, headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  it('POST read zeroes unread and marks read on WA', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const jid = '60144444444@s.whatsapp.net';
    await seedChat(jid, 'Dan', Date.now());
    expect(getChats(t.ctx).get(jid)!.unreadCount).toBe(1);
    const r = await t.app.inject({ method: 'POST', url: `/api/chats/${enc(jid)}/read`, headers: authHeaders(cookie) });
    expect(r.statusCode).toBe(200);
    expect(getChats(t.ctx).get(jid)!.unreadCount).toBe(0);
    expect(t.wa.reads.some((x) => x.chatJid === jid && x.messageIds.includes(`seed-${jid}`))).toBe(true);
  });

  it('since= returns chats updated after a timestamp', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    await seedChat('60155555555@s.whatsapp.net', 'Eve', Date.now());
    const later = Date.now() + 60_000;
    const r = await t.app.inject({ method: 'GET', url: `/api/chats?since=${later}`, headers: { cookie } });
    expect(ChatListResponse.parse(r.json()).chats).toEqual([]);
  });

  it('notes: add + list, emits note:new', async () => {
    const { user, cookie } = await createUserAndLogin(t, { role: 'agent' });
    const jid = '60166666666@s.whatsapp.net';
    await seedChat(jid, 'Fay', Date.now());
    const emitted: number[] = [];
    t.ctx.bus.on('note:new', (n) => emitted.push(n.id));
    let r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(jid)}/notes`,
      headers: authHeaders(cookie),
      payload: { body: 'VIP customer' },
    });
    expect(r.statusCode).toBe(201);
    const note = NoteSchema.parse(r.json());
    expect(note.userId).toBe(user.id);
    expect(emitted).toEqual([note.id]);
    r = await t.app.inject({ method: 'GET', url: `/api/chats/${enc(jid)}/notes`, headers: { cookie } });
    expect(r.json().notes.map((n: { body: string }) => n.body)).toEqual(['VIP customer']);
  });
});

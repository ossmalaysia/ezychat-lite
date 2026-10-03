import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChatDetailResponse,
  ChatListResponse,
  ChatSchema,
  NoteSchema,
} from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { rowToChat, type ChatRow } from '../src/chats/repo.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

describe('chat profile images', () => {
  const jid = '60177777777@s.whatsapp.net';
  const photo = 'https://pps.whatsapp.net/v/t61.24694-24/profile.jpg?token=test';
  const avatar = (chatJid = jid) => `/api/chats/${enc(chatJid)}/avatar`;

  it('requires authentication without querying WhatsApp', async () => {
    await seedChat(jid, 'Profile test', Date.now());
    const lookup = vi.spyOn(t.wa, 'getProfilePicture').mockResolvedValue(photo);
    const r = await t.app.inject({ method: 'GET', url: avatar() });
    expect(r.statusCode).toBe(401);
    expect(r.headers.location).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('gives list and detail responses an encoded same-origin avatar endpoint', async () => {
    const { cookie } = await createUserAndLogin(t);
    const groupJid = '120363012345@g.us';
    await seedChat(jid, 'Profile test', Date.now());
    await seedChat(groupJid, 'Group profile test', Date.now());
    const lookup = vi.spyOn(t.wa, 'getProfilePicture');
    const list = await t.app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const chats = ChatListResponse.parse(list.json()).chats;
    expect(chats).toHaveLength(2);
    for (const chat of chats) {
      expect(chat.avatarUrl).toBe(avatar(chat.jid));
      const detail = await t.app.inject({
        method: 'GET',
        url: `/api/chats/${enc(chat.jid)}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(ChatDetailResponse.parse(detail.json()).chat.avatarUrl).toBe(avatar(chat.jid));
    }
    // Rendering a directory does not fetch every contact's photo from WhatsApp.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('redirects an authenticated agent to an HTTPS WhatsApp photo and caches privately', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    await seedChat(jid, 'Profile test', Date.now());
    const lookup = vi.spyOn(t.wa, 'getProfilePicture').mockResolvedValue(photo);
    const r = await t.app.inject({ method: 'GET', url: avatar(), headers: { cookie } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(photo);
    expect(r.headers['cache-control']).toBe('private, max-age=300');
    expect(lookup).toHaveBeenCalledExactlyOnceWith(jid);
  });

  it('returns no image for missing or private photos and caches that result', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seedChat(jid, 'Profile test', Date.now());
    const lookup = vi.spyOn(t.wa, 'getProfilePicture').mockResolvedValue(null);
    for (let i = 0; i < 2; i++) {
      const r = await t.app.inject({ method: 'GET', url: avatar(), headers: { cookie } });
      expect(r.statusCode).toBe(204);
      expect(r.body).toBe('');
      expect(r.headers.location).toBeUndefined();
    }
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('falls back to no image when WhatsApp lookup fails', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seedChat(jid, 'Profile test', Date.now());
    const lookup = vi
      .spyOn(t.wa, 'getProfilePicture')
      .mockRejectedValue(new Error('Photo is private'));
    const r = await t.app.inject({ method: 'GET', url: avatar(), headers: { cookie } });
    expect(r.statusCode).toBe(204);
    expect(r.headers.location).toBeUndefined();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe, malformed, credential-bearing and non-WhatsApp destinations', async () => {
    const { cookie } = await createUserAndLogin(t);
    const unsafe = [
      'http://pps.whatsapp.net/profile.jpg',
      'https://example.com/profile.jpg',
      'https://whatsapp.net.evil.example/profile.jpg',
      'https://evilwhatsapp.net/profile.jpg',
      'https://pps.whatsapp.net@evil.example/profile.jpg',
      'https://user:secret@pps.whatsapp.net/profile.jpg',
      'https://pps.whatsapp.net:8443/profile.jpg',
      'https://127.0.0.1/profile.jpg',
      'data:image/png;base64,AAAA',
      '/relative-photo.jpg',
      'not a URL',
    ];
    const lookup = vi.spyOn(t.wa, 'getProfilePicture');
    for (const [i, url] of unsafe.entries()) {
      const chatJid = `601888880${i}@s.whatsapp.net`;
      await seedChat(chatJid, 'Unsafe image test', Date.now());
      lookup.mockResolvedValueOnce(url);
      const r = await t.app.inject({ method: 'GET', url: avatar(chatJid), headers: { cookie } });
      expect(r.statusCode, url).toBe(204);
      expect(r.headers.location, url).toBeUndefined();
    }
    expect(lookup).toHaveBeenCalledTimes(unsafe.length);
  });

  it('coalesces concurrent lookups and reuses the cached result', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seedChat(jid, 'Profile test', Date.now());
    let finishLookup!: (url: string | null) => void;
    const pending = new Promise<string | null>((resolve) => {
      finishLookup = resolve;
    });
    const lookup = vi.spyOn(t.wa, 'getProfilePicture').mockReturnValue(pending);
    const first = t.app
      .inject({ method: 'GET', url: avatar(), headers: { cookie } })
      .then((r) => r);
    const second = t.app
      .inject({ method: 'GET', url: avatar(), headers: { cookie } })
      .then((r) => r);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    finishLookup(photo);
    const responses = await Promise.all([first, second]);
    for (const r of responses) {
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe(photo);
    }
    const cached = await t.app.inject({ method: 'GET', url: avatar(), headers: { cookie } });
    expect(cached.statusCode).toBe(302);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cached image after five minutes', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seedChat(jid, 'Profile test', Date.now());
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const updatedPhoto = 'https://pps.whatsapp.net/profile-new.jpg';
    const lookup = vi
      .spyOn(t.wa, 'getProfilePicture')
      .mockResolvedValueOnce(photo)
      .mockResolvedValueOnce(updatedPhoto);
    const request = () => t.app.inject({ method: 'GET', url: avatar(), headers: { cookie } });
    expect((await request()).headers.location).toBe(photo);
    clock.mockReturnValue(now + 5 * 60_000 - 1);
    expect((await request()).headers.location).toBe(photo);
    expect(lookup).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 5 * 60_000);
    expect((await request()).headers.location).toBe(updatedPhoto);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('returns 404 for an unknown chat without querying WhatsApp', async () => {
    const { cookie } = await createUserAndLogin(t);
    const lookup = vi.spyOn(t.wa, 'getProfilePicture').mockResolvedValue(photo);
    const r = await t.app.inject({ method: 'GET', url: avatar(), headers: { cookie } });
    expect(r.statusCode).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not query WhatsApp while disconnected, then loads a photo after reconnecting', async () => {
    const { cookie } = await createUserAndLogin(t);
    await seedChat(jid, 'Profile test', Date.now());
    const lookup = vi.spyOn(t.wa, 'getProfilePicture').mockResolvedValue(photo);
    await t.wa.disconnect();
    const request = () => t.app.inject({ method: 'GET', url: avatar(), headers: { cookie } });
    const disconnected = await request();
    expect(disconnected.statusCode).toBe(204);
    expect(disconnected.headers.location).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    await t.wa.connect();
    const connected = await request();
    expect(connected.statusCode).toBe(302);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('rowToChat encodes the JID and does not expose a stored image path', () => {
    const row: ChatRow = {
      jid: '60123:7@s.whatsapp.net',
      type: 'dm',
      name: 'Profile test',
      avatar_path: 'C:\\private\\media\\profile.jpg',
      unread_count: 0,
      last_message_at: null,
      last_message_preview: null,
      status: 'open',
      assigned_to: null,
      updated_at: Date.now(),
    };
    expect(rowToChat(row).avatarUrl).toBe('/api/chats/60123%3A7%40s.whatsapp.net/avatar');
  });
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
    for (let i = 0; i < 5; i++)
      await seedChat(`6011100000${i}@s.whatsapp.net`, `Person${i}`, base + i * 1000);
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
    expect((await list('assigned=me')).chats.map((c) => c.jid)).toEqual([
      '60111000001@s.whatsapp.net',
    ]);
    expect((await list('assigned=none')).chats.length).toBe(5);
    expect((await list('status=resolved')).chats.map((c) => c.jid)).toEqual([
      '60111000002@s.whatsapp.net',
    ]);
    expect((await list('status=open')).chats.length).toBe(5);
    expect((await list('q=person3')).chats.map((c) => c.jid)).toEqual([
      '60111000003@s.whatsapp.net',
    ]);
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

    let r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(jid)}`,
      headers: { cookie },
    });
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
    r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc('nope@s.whatsapp.net')}`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it('POST read zeroes unread and marks read on WA', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const jid = '60144444444@s.whatsapp.net';
    await seedChat(jid, 'Dan', Date.now());
    expect(getChats(t.ctx).get(jid)!.unreadCount).toBe(1);
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(jid)}/read`,
      headers: authHeaders(cookie),
    });
    expect(r.statusCode).toBe(200);
    expect(getChats(t.ctx).get(jid)!.unreadCount).toBe(0);
    expect(t.wa.reads.some((x) => x.chatJid === jid && x.messageIds.includes(`seed-${jid}`))).toBe(
      true,
    );
  });

  it('since= returns chats updated after a timestamp', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    await seedChat('60155555555@s.whatsapp.net', 'Eve', Date.now());
    const later = Date.now() + 60_000;
    const r = await t.app.inject({
      method: 'GET',
      url: `/api/chats?since=${later}`,
      headers: { cookie },
    });
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
    r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(jid)}/notes`,
      headers: { cookie },
    });
    expect(r.json().notes.map((n: { body: string }) => n.body)).toEqual(['VIP customer']);
  });
});

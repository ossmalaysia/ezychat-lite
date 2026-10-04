import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpenChatCountResponse, ResolveAllChatsResponse } from '@wa-team-inbox/shared';
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

it('requires an admin and explicit confirmation, and enforces same-origin requests', async () => {
  const { cookie } = await createUserAndLogin(t);
  const admin = await createUserAndLogin(t, { role: 'admin' });
  const chats = getChats(t.ctx);
  chats.upsertFromWa({ jid: '60123@s.whatsapp.net', type: 'dm', name: 'Customer' });
  for (const auth of [undefined, cookie]) {
    const headers = auth ? authHeaders(auth) : {};
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/chats/resolve-all',
          headers,
          payload: { confirmed: true },
        })
      ).statusCode,
    ).toBe(auth ? 403 : 401);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/chats/open-count', headers })).statusCode,
    ).toBe(auth ? 403 : 401);
  }
  for (const payload of [{}, { confirmed: false }]) {
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/chats/resolve-all',
          headers: authHeaders(admin.cookie),
          payload,
        })
      ).statusCode,
    ).toBe(400);
  }
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: '/api/chats/resolve-all',
        headers: { ...authHeaders(admin.cookie), origin: 'https://evil.example' },
        payload: { confirmed: true },
      })
    ).statusCode,
  ).toBe(403);
  expect(chats.openCount()).toBe(1);
});

it('resolves beyond a page of DMs and groups, releases owners, preserves history, publishes committed events and audits the admin', async () => {
  const { user, cookie } = await createUserAndLogin(t, { role: 'admin' });
  const chats = getChats(t.ctx);
  for (let i = 0; i < 205; i++)
    chats.upsertFromWa({ jid: `${i}@s.whatsapp.net`, type: 'dm', name: `Customer ${i}` });
  const jid = '123@g.us';
  await getMessages(t.ctx).ingest(
    {
      id: 'incoming',
      chatJid: jid,
      senderJid: '1@s.whatsapp.net',
      senderName: 'Customer',
      fromMe: false,
      type: 'text',
      body: 'Keep this message',
      quotedId: null,
      timestamp: Date.now(),
      media: null,
    },
    'live',
  );
  chats.patch(jid, { assignedTo: user.id }, user.id);
  chats.addNote(jid, user.id, 'Keep this note');
  chats.patch('0@s.whatsapp.net', { status: 'resolved', assignedTo: user.id }, user.id);
  const alreadyResolved = chats.get('0@s.whatsapp.net');
  const updates = vi.fn(() => expect(chats.openCount()).toBe(0));
  t.ctx.bus.on('chat:updated', updates);
  const events = vi.fn();
  t.ctx.bus.on('chat:event', events);
  const count = await t.app.inject({
    method: 'GET',
    url: '/api/chats/open-count',
    headers: { cookie },
  });
  expect(count.statusCode).toBe(200);
  expect(OpenChatCountResponse.parse(count.json())).toEqual({ openCount: 205 });
  const request = () =>
    t.app.inject({
      method: 'POST',
      url: '/api/chats/resolve-all',
      headers: authHeaders(cookie),
      payload: { confirmed: true },
    });
  const result = await request();
  expect(result.statusCode).toBe(200);
  expect(ResolveAllChatsResponse.parse(result.json())).toEqual({ resolvedCount: 205 });
  expect(updates).toHaveBeenCalledTimes(205);
  expect(events).toHaveBeenCalledTimes(206);
  expect(chats.get(jid)).toMatchObject({ status: 'resolved', assignedTo: null, unreadCount: 1 });
  expect(chats.get('0@s.whatsapp.net')).toEqual(alreadyResolved);
  expect(chats.events(jid).slice(-2)).toMatchObject([
    { type: 'resolved', actorId: user.id },
    { type: 'unassigned', actorId: user.id },
  ]);
  expect(chats.listNotes(jid)[0]?.body).toBe('Keep this note');
  expect(t.ctx.db.prepare('SELECT body FROM messages WHERE id = ?').get('incoming')).toEqual({
    body: 'Keep this message',
  });
  const audit = t.ctx.db
    .prepare("SELECT user_id, meta FROM audit_log WHERE action = 'chats.resolve_all'")
    .get() as { user_id: number; meta: string };
  expect(audit.user_id).toBe(user.id);
  expect(JSON.parse(audit.meta)).toEqual({ resolvedCount: 205 });
  expect((await request()).json()).toEqual({ resolvedCount: 0 });
  expect(events).toHaveBeenCalledTimes(206);
  t.ctx.bus.off('chat:updated', updates);
  await getMessages(t.ctx).ingest(
    {
      id: 'returning',
      chatJid: jid,
      senderJid: '1@s.whatsapp.net',
      senderName: 'Customer',
      fromMe: false,
      type: 'text',
      body: 'Back again',
      quotedId: null,
      timestamp: Date.now(),
      media: null,
    },
    'live',
  );
  expect(chats.get(jid)).toMatchObject({ status: 'open', assignedTo: null });
});

it('rolls back the entire reset and emits nothing when writing an event fails', async () => {
  const { user } = await createUserAndLogin(t, { role: 'admin' });
  const chats = getChats(t.ctx);
  for (const jid of ['1@s.whatsapp.net', '2@s.whatsapp.net'])
    chats.upsertFromWa({ jid, type: 'dm', name: null });
  t.ctx.db.exec(
    "CREATE TRIGGER fail_reset BEFORE INSERT ON chat_events WHEN NEW.chat_jid = '2@s.whatsapp.net' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const update = vi.fn();
  const event = vi.fn();
  t.ctx.bus.on('chat:updated', update);
  t.ctx.bus.on('chat:event', event);
  expect(() => chats.resolveAll(user.id)).toThrow('test failure');
  expect(chats.openCount()).toBe(2);
  expect(chats.events('1@s.whatsapp.net')).toEqual([]);
  expect(update).not.toHaveBeenCalled();
  expect(event).not.toHaveBeenCalled();
});

it('rolls back chats and events without publishing when the audit write fails', async () => {
  const { user, cookie } = await createUserAndLogin(t, { role: 'admin' });
  const chats = getChats(t.ctx);
  const jid = '1@s.whatsapp.net';
  chats.upsertFromWa({ jid, type: 'dm', name: null });
  chats.patch(jid, { assignedTo: user.id }, user.id);
  const before = chats.get(jid);
  const beforeEvents = chats.events(jid);
  t.ctx.db.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'chats.resolve_all' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
  );
  const update = vi.fn();
  const event = vi.fn();
  t.ctx.bus.on('chat:updated', update);
  t.ctx.bus.on('chat:event', event);
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/chats/resolve-all',
    headers: authHeaders(cookie),
    payload: { confirmed: true },
  });
  expect(response.statusCode).toBe(500);
  expect(chats.get(jid)).toEqual(before);
  expect(chats.events(jid)).toEqual(beforeEvents);
  expect(update).not.toHaveBeenCalled();
  expect(event).not.toHaveBeenCalled();
  expect(
    t.ctx.db
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'chats.resolve_all'")
      .get(),
  ).toEqual({ count: 0 });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, User } from '@ezychat/shared';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const C = '60123000111@s.whatsapp.net';
const C2 = `${C}#2`;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let t: TestApp;
const sockets: ClientSocket[] = [];
let admin: { user: User; cookie: string };
let agent: { user: User; cookie: string };

function connect(cookie: string): ClientSocket {
  const s: ClientSocket = ioClient(t.url!, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie },
    forceNew: true,
  });
  sockets.push(s);
  return s;
}

function waitConnect(s: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', (err) => reject(err));
  });
}

/** Every event a socket receives, by name, with its first argument. */
function record(s: ClientSocket): Array<{ ev: string; arg: unknown }> {
  const seen: Array<{ ev: string; arg: unknown }> = [];
  s.onAny((ev: string, arg: unknown) => seen.push({ ev, arg }));
  return seen;
}

async function until(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await delay(10);
  }
}

const chatOf = (arg: unknown): string | undefined => {
  const a = arg as { chatJid?: string; jid?: string; inboxId?: number } | undefined;
  return a?.chatJid ?? a?.jid;
};
const touches = (seen: Array<{ ev: string; arg: unknown }>, key: string) =>
  seen.filter((e) => chatOf(e.arg) === key).map((e) => e.ev);

beforeEach(async () => {
  t = await makeTestApp({ listen: true, maxInboxes: 3, inboxes: 2 });
  admin = await createUserAndLogin(t, { role: 'admin' });
  agent = await createUserAndLogin(t);
  t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [1]);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await t.close();
});

async function both() {
  const a = connect(admin.cookie);
  const b = connect(agent.cookie);
  await Promise.all([waitConnect(a), waitConnect(b)]);
  return { a, b, seenA: record(a), seenB: record(b) };
}

describe('inbox socket rooms (RF-3)', () => {
  it('inbox 2 events reach the admin only; inbox 1 events reach both', async () => {
    const { a, b, seenA, seenB } = await both();
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'one' });
    await until(() => touches(seenA, C2).includes('message:new'));
    await until(() => touches(seenB, C).includes('message:new'));
    // typing and notes for inbox 2
    a.emit('typing', { chatJid: C2 });
    t.ctx.bus.emit('note:new', {
      id: 1,
      chatJid: C2,
      userId: admin.user.id,
      body: 'x',
      createdAt: 1,
    });
    t.ctx.bus.emit('chat:event', {
      id: 1,
      chatJid: C2,
      type: 'resolved',
      actorId: null,
      payload: {},
      at: 1,
    } as never);
    // inbox status
    t.inboxWa(2).simulateStatus({ state: 'qr', qr: 'qr-two' });
    t.inboxWa(1).simulateStatus({ state: 'qr', qr: 'qr-one' });
    await until(() =>
      seenA.some((e) => e.ev === 'inbox:status' && (e.arg as { inboxId: number }).inboxId === 2),
    );
    await until(() => seenB.some((e) => e.ev === 'inbox:status'));
    await delay(100);
    expect(touches(seenA, C2)).toEqual(
      expect.arrayContaining(['message:new', 'chat:updated', 'note:new', 'chat:event']),
    );
    expect(touches(seenB, C2)).toEqual([]);
    expect(seenB.filter((e) => e.ev === 'typing')).toEqual([]);
    expect(touches(seenB, C)).toEqual(expect.arrayContaining(['message:new', 'chat:updated']));
    const statusB = seenB.filter((e) => e.ev === 'inbox:status').map((e) => e.arg);
    expect(statusB).toEqual([{ inboxId: 1, status: expect.objectContaining({ qr: null }) }]);
    const statusA = seenA
      .filter((e) => e.ev === 'inbox:status')
      .map((e) => e.arg as { inboxId: number; status: { qr: string | null } });
    expect(statusA.find((s) => s.inboxId === 2)!.status.qr).toBe('qr-two');
    // the agent's typing in an inbox 2 chat goes nowhere
    b.emit('typing', { chatJid: C2 });
    await delay(100);
    expect(seenA.filter((e) => e.ev === 'typing' && chatOf(e.arg) === C2)).toEqual([]);
  });

  it('reaction changes reach only the users who may open the chat inbox', async () => {
    const { seenA, seenB } = await both();
    const two = t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    const one = t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'one' });
    await until(() => touches(seenA, C2).includes('message:new'));
    await until(() => touches(seenB, C).includes('message:new'));
    t.inboxWa(2).simulateReaction({ chatJid: C, targetId: two.id, emoji: '👍' });
    t.inboxWa(1).simulateReaction({ chatJid: C, targetId: one.id, emoji: '❤️' });
    await until(() => touches(seenA, C2).includes('message:reactions'));
    await until(() => touches(seenB, C).includes('message:reactions'));
    await delay(100);
    expect(touches(seenB, C2)).toEqual([]);
    expect(seenB.filter((e) => e.ev === 'message:reactions').map((e) => e.arg)).toEqual([
      {
        chatJid: C,
        messageId: one.id,
        reactions: [expect.objectContaining({ emoji: '❤️', senderJid: C })],
      },
    ]);
  });

  it('access changes move live sockets in and out of inbox rooms without reconnecting', async () => {
    const { seenB } = await both();
    const put = (inboxIds: number[]) =>
      t.app.inject({
        method: 'PUT',
        url: `/api/users/${agent.user.id}/inboxes`,
        headers: authHeaders(admin.cookie),
        payload: { inboxIds },
      });
    expect((await put([1, 2])).statusCode).toBe(200);
    await until(() => seenB.some((e) => e.ev === 'inboxes:changed'));
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'now visible' });
    await until(() => touches(seenB, C2).includes('message:new'));

    expect((await put([1])).statusCode).toBe(200);
    await delay(50);
    const before = touches(seenB, C2).length;
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'hidden again' });
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'marker' });
    await until(() =>
      seenB.some((e) => e.ev === 'message:new' && (e.arg as { body: string }).body === 'marker'),
    );
    await delay(50);
    expect(touches(seenB, C2).length).toBe(before);
  });

  it('a new inbox reaches admin sockets at once; removing it tells everyone', async () => {
    const { seenA, seenB } = await both();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/inboxes',
      headers: authHeaders(admin.cookie),
      payload: { name: 'Three' },
    });
    expect(res.statusCode).toBe(201);
    await until(() => seenA.some((e) => e.ev === 'inboxes:changed'));
    t.inboxWa(3).simulateIncoming({ chatJid: C, body: 'three' });
    await until(() => touches(seenA, `${C}#3`).includes('message:new'));
    const del = await t.app.inject({
      method: 'DELETE',
      url: '/api/inboxes/3',
      headers: authHeaders(admin.cookie),
    });
    expect(del.statusCode).toBe(204);
    await until(() => seenB.filter((e) => e.ev === 'inboxes:changed').length >= 2);
    expect(touches(seenB, `${C}#3`)).toEqual([]);
  });

  it('an event with a key that does not parse reaches admins only', async () => {
    const { seenA, seenB } = await both();
    const bad = { jid: `${C}#x`, inboxId: 1 } as never;
    t.ctx.bus.emit('chat:updated', bad);
    await until(() => touches(seenA, `${C}#x`).includes('chat:updated'));
    await delay(50);
    expect(touches(seenB, `${C}#x`)).toEqual([]);
  });

  it('a promoted agent joins every inbox room', async () => {
    const { seenB } = await both();
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${agent.user.id}`,
      headers: authHeaders(admin.cookie),
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    await delay(50);
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'for admins' });
    await until(() => touches(seenB, C2).includes('message:new'));
  });
});

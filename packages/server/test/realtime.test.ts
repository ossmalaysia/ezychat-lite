import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, WaStatus } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let t: TestApp;
const sockets: ClientSocket[] = [];

function connect(cookie?: string, origin?: string): ClientSocket {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const s: ClientSocket = ioClient(t.url!, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: headers,
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

function waitEvent(s: ClientSocket, ev: keyof ServerToClientEvents, ms = 2000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    (s as unknown as { once(e: string, fn: (...a: unknown[]) => void): void }).once(ev, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  t = await makeTestApp({ listen: true });
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await t.close();
});

describe('realtime', () => {
  it('connects with a valid session cookie and is rejected without one', async () => {
    const { cookie, user } = await createUserAndLogin(t);
    const ok = connect(cookie);
    await waitConnect(ok);
    expect(ok.connected).toBe(true);
    expect(t.ctx.services.realtime!.isOnline(user.id)).toBe(true);

    const bad = connect();
    await expect(waitConnect(bad)).rejects.toBeTruthy();

    const forged = connect('sid=not-a-real-token');
    await expect(waitConnect(forged)).rejects.toBeTruthy();
  });

  it('rejects a cross-origin handshake', async () => {
    const { cookie } = await createUserAndLogin(t);
    const s = connect(cookie, 'http://evil.example');
    await expect(waitConnect(s)).rejects.toBeTruthy();
  });

  it('rejects a user who must change password', async () => {
    const { cookie, user } = await createUserAndLogin(t);
    t.ctx.db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
    const s = connect(cookie);
    await expect(waitConnect(s)).rejects.toBeTruthy();
  });

  it('receives message:new after an incoming WhatsApp message', async () => {
    const { cookie } = await createUserAndLogin(t);
    const s = connect(cookie);
    await waitConnect(s);
    const p = waitEvent(s, 'message:new');
    t.wa.simulateIncoming({ chatJid: '60111@s.whatsapp.net', body: 'hello realtime' });
    const [m] = (await p) as [{ body: string }];
    expect(m.body).toBe('hello realtime');
  });

  it('strips the QR code for agents but not admins', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const sa = connect(admin.cookie);
    const sg = connect(agent.cookie);
    await Promise.all([waitConnect(sa), waitConnect(sg)]);
    const pa = waitEvent(sa, 'wa:status');
    const pg = waitEvent(sg, 'wa:status');
    t.wa.simulateStatus({ state: 'qr', qr: 'SECRET-QR' });
    const [[sAdmin], [sAgent]] = (await Promise.all([pa, pg])) as [[WaStatus], [WaStatus]];
    expect(sAdmin.qr).toBe('SECRET-QR');
    expect(sAgent.state).toBe('qr');
    expect(sAgent.qr).toBeNull();
  });

  it('disabling a user emits session:revoked and disconnects their socket', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const s = connect(agent.cookie);
    await waitConnect(s);
    const revoked = waitEvent(s, 'session:revoked');
    const disconnected = new Promise<string>((r) => s.once('disconnect', (reason) => r(reason)));
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${agent.user.id}`,
      headers: authHeaders(admin.cookie),
      payload: { disabled: true },
    });
    expect(res.statusCode).toBe(200);
    await revoked;
    await disconnected;
    expect(s.connected).toBe(false);
    await delay(50);
    expect(t.ctx.services.realtime!.isOnline(agent.user.id)).toBe(false);
  });

  it('relays typing to other users but not the sender', async () => {
    const a = await createUserAndLogin(t);
    const b = await createUserAndLogin(t);
    const sa = connect(a.cookie);
    const sb = connect(b.cookie);
    await Promise.all([waitConnect(sa), waitConnect(sb)]);
    let senderGot = false;
    sa.on('typing', () => {
      senderGot = true;
    });
    const p = waitEvent(sb, 'typing');
    sa.emit('typing', { chatJid: '60111@s.whatsapp.net' });
    const [payload] = await p;
    expect(payload).toEqual({ chatJid: '60111@s.whatsapp.net', userId: a.user.id, displayName: a.user.displayName });
    await delay(100);
    expect(senderGot).toBe(false);
  });

  it('throttles typing to one event per 2s per user+chat', async () => {
    const a = await createUserAndLogin(t);
    const b = await createUserAndLogin(t);
    const sa = connect(a.cookie);
    const sb = connect(b.cookie);
    await Promise.all([waitConnect(sa), waitConnect(sb)]);
    let count = 0;
    sb.on('typing', () => {
      count += 1;
    });
    sa.emit('typing', { chatJid: 'x@s.whatsapp.net' });
    sa.emit('typing', { chatJid: 'x@s.whatsapp.net' });
    sa.emit('typing', { chatJid: 'x@s.whatsapp.net' });
    sa.emit('typing', { chatJid: 'y@s.whatsapp.net' });
    await delay(200);
    expect(count).toBe(2);
  });
});

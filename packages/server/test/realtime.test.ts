import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
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
    (s as unknown as { once(e: string, fn: (...a: unknown[]) => void): void }).once(
      ev,
      (...args: unknown[]) => {
        clearTimeout(timer);
        resolve(args);
      },
    );
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

  it('sends connected notification previews only to the assigned active user', async () => {
    const owner = await createUserAndLogin(t);
    const other = await createUserAndLogin(t);
    const a = connect(owner.cookie);
    const b = connect(other.cookie);
    await Promise.all([waitConnect(a), waitConnect(b)]);
    // Create the chat first; then assign before the inbound event under test.
    const created = waitEvent(a, 'chat:updated');
    t.wa.simulateIncoming({ chatJid: '601111@s.whatsapp.net', body: 'Initial message' });
    await created;
    t.ctx.db
      .prepare('UPDATE chats SET assigned_to = ? WHERE jid = ?')
      .run(owner.user.id, '601111@s.whatsapp.net');
    await delay(50);
    let leaked = false;
    b.on('notification:new', () => {
      leaked = true;
    });
    const notification = waitEvent(a, 'notification:new');
    t.wa.simulateIncoming({ chatJid: '601111@s.whatsapp.net', body: 'Owner only' });
    const [payload] = await notification;
    expect(payload).toMatchObject({
      body: 'Owner only',
      tag: '601111@s.whatsapp.net',
      url: '/chats/601111%40s.whatsapp.net',
    });
    await delay(50);
    expect(leaked).toBe(false);
  });

  it('alerts connected team members for an unassigned chat and sends status alerts only to admins', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const a = connect(admin.cookie);
    const b = connect(agent.cookie);
    await Promise.all([waitConnect(a), waitConnect(b)]);
    const inbound = [waitEvent(a, 'notification:new'), waitEvent(b, 'notification:new')];
    t.wa.simulateIncoming({ chatJid: '601112@s.whatsapp.net', body: 'Team alert' });
    expect((await Promise.all(inbound)).map(([p]) => p)).toEqual([
      expect.objectContaining({ body: 'Team alert' }),
      expect.objectContaining({ body: 'Team alert' }),
    ]);
    let leaked = false;
    b.on('notification:new', () => {
      leaked = true;
    });
    const alert = waitEvent(a, 'notification:new');
    t.wa.simulateStatus({ state: 'logged_out' });
    expect((await alert)[0]).toMatchObject({ url: '/admin/whatsapp', tag: 'wa-status' });
    await delay(50);
    expect(leaked).toBe(false);
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

  it('rejects a handshake with a non-allowlisted Host (DNS rebinding)', async () => {
    const { cookie } = await createUserAndLogin(t);
    const status = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const u = new URL(t.url!);
        const req = httpRequest(
          {
            host: u.hostname,
            port: u.port,
            path: '/socket.io/?EIO=4&transport=polling',
            headers: { host, cookie },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
    expect(await status(`evil.com:${new URL(t.url!).port}`)).toBe(403);
    expect(await status(new URL(t.url!).host)).toBe(200);
  });

  it('demoting an admin removes them from the admins room (no QR)', async () => {
    const boss = await createUserAndLogin(t, { role: 'admin' });
    const other = await createUserAndLogin(t, { role: 'admin' });
    const s = connect(other.cookie);
    await waitConnect(s);
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${other.user.id}`,
      headers: authHeaders(boss.cookie),
      payload: { role: 'agent' },
    });
    expect(res.statusCode).toBe(200);
    await delay(50);
    const p = waitEvent(s, 'wa:status');
    t.wa.simulateStatus({ state: 'qr', qr: 'SECRET-QR' });
    const [st] = (await p) as [WaStatus];
    expect(st.qr).toBeNull();
    expect(s.connected).toBe(true);
  });

  it('changing password disconnects sockets of other sessions but keeps the current one', async () => {
    const u = await createUserAndLogin(t, { password: 'password123' });
    const login2 = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: u.user.username, password: 'password123' },
      remoteAddress: '10.250.0.1',
    });
    const cookie2 = `sid=${login2.cookies.find((c) => c.name === 'sid')!.value}`;
    const mine = connect(u.cookie);
    const attacker = connect(cookie2);
    await Promise.all([waitConnect(mine), waitConnect(attacker)]);
    const revoked = waitEvent(attacker, 'session:revoked');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(u.cookie),
      payload: { currentPassword: 'password123', newPassword: 'newpassword456' },
    });
    expect(res.statusCode).toBe(200);
    await revoked;
    await delay(50);
    expect(attacker.connected).toBe(false);
    expect(mine.connected).toBe(true);
  });

  it('logout disconnects the socket of that session', async () => {
    const u = await createUserAndLogin(t);
    const s = connect(u.cookie);
    await waitConnect(s);
    const revoked = waitEvent(s, 'session:revoked');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: authHeaders(u.cookie),
    });
    expect(res.statusCode).toBe(200);
    await revoked;
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
    expect(payload).toEqual({
      chatJid: '60111@s.whatsapp.net',
      userId: a.user.id,
      displayName: a.user.displayName,
    });
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

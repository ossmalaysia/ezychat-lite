import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  HealthResponse,
  accessStatusSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@ezychat/shared';
import type { ServerExtension } from '../src/index.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let t: TestApp | undefined;
const sockets: ClientSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await t?.close();
  t = undefined;
});

const CODE = 'license_required';

function licensing(): ServerExtension {
  return {
    name: 'lic',
    routes: async (api) => {
      api.get('/host/status', async () => ({ host: true }));
      api.post('/host/activate', async () => ({ activated: true }));
      api.get('/info', async () => ({ info: true }));
    },
  };
}

const sessionCount = (tt: TestApp) =>
  (tt.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

// Every test builds a full app (makeTestApp): the Windows CI runner needs more than 5 s.
describe('access gate', { timeout: 20_000 }, () => {
  it('is open in Lite: /api/access and /api/health say so', async () => {
    t = await makeTestApp();
    const access = await t.app.inject({ method: 'GET', url: '/api/access' });
    expect(access.statusCode).toBe(200);
    expect(accessStatusSchema.parse(access.json())).toEqual({ open: true });
    const health = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(HealthResponse.parse(health.json()).access).toBe('open');
    expect(t.ctx.access.state()).toEqual({ open: true });
  });

  it('rejects codes that are not stable machine codes', async () => {
    t = await makeTestApp();
    expect(() => t!.ctx.access.close({ code: 'Not A Code' })).toThrow();
    expect(() => t!.ctx.access.close({ code: '' })).toThrow();
    expect(t.ctx.access.state().open).toBe(true);
  });

  it('answers 403 { error: code } for /api and /mcp, except health, access and static pages', async () => {
    t = await makeTestApp();
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const closed = vi.fn();
    t.ctx.bus.on('access:closed', closed);
    t.ctx.access.close({ code: CODE, reason: 'secret detail' });
    expect(closed).toHaveBeenCalledWith({ code: CODE });

    for (const url of ['/api/chats', '/api/auth/me', '/api/setup/status', '/api', '/api/nope']) {
      const res = await t.app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toEqual({ error: CODE });
    }
    const post = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: authHeaders(cookie),
      payload: { username: 'x', password: 'y' },
    });
    expect(post.statusCode).toBe(403);
    expect(post.json()).toEqual({ error: CODE });
    const mcp = await t.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(mcp.statusCode).toBe(403);
    expect(mcp.json()).toEqual({ error: CODE });
    // A percent-encoded path never slips past the gate.
    const encoded = await t.app.inject({ method: 'GET', url: '/%61pi/chats', headers: { cookie } });
    expect(encoded.statusCode).not.toBe(200);

    const health = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(HealthResponse.parse(health.json()).access).toBe('closed');
    const access = await t.app.inject({ method: 'GET', url: '/api/access' });
    expect(access.json()).toEqual({ open: false, code: CODE });
    expect(access.body).not.toContain('secret detail');

    // Non-API paths (web assets / SPA) are not gated by the access hook.
    const page = await t.app.inject({ method: 'GET', url: '/inbox' });
    expect(page.statusCode).not.toBe(403);
  });

  it('deletes every session on close; reopening needs a new sign-in', async () => {
    t = await makeTestApp();
    const a = await createUserAndLogin(t, { role: 'admin' });
    await createUserAndLogin(t);
    expect(sessionCount(t)).toBeGreaterThanOrEqual(2);
    t.ctx.access.close({ code: CODE });
    expect(sessionCount(t)).toBe(0);
    const opened = vi.fn();
    t.ctx.bus.on('access:opened', opened);
    t.ctx.access.open();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(t.ctx.access.state()).toEqual({ open: true });
    const old = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: a.cookie },
    });
    expect(old.statusCode).toBe(401);
    const again = await createUserAndLogin(t);
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: again.cookie },
    });
    expect(me.statusCode).toBe(200);
  });

  it('keeps storing WhatsApp messages while closed; they are in the inbox after reopen', async () => {
    t = await makeTestApp();
    t.ctx.access.close({ code: CODE });
    t.wa.simulateIncoming({ chatJid: '60123456789@s.whatsapp.net', body: 'hello while paused' });
    await vi.waitFor(() => {
      const row = t!.ctx.db
        .prepare('SELECT COUNT(*) AS n FROM messages WHERE body = ?')
        .get('hello while paused') as { n: number };
      expect(row.n).toBe(1);
    });
    t.ctx.access.open();
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const chats = await t.app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } });
    expect(chats.statusCode).toBe(200);
    expect(chats.body).toContain('60123456789');
  });

  it('pauses push while closed and resumes it on open', async () => {
    t = await makeTestApp();
    const { user } = await createUserAndLogin(t);
    const emit = vi.fn();
    t.ctx.services.realtime = {
      io: { to: () => ({ emit }) } as never,
      close() {},
      isOnline: () => true,
    };
    const push = t.ctx.services.push!;
    const chat = { jid: 'x@s.whatsapp.net', name: 'X', assignedTo: user.id } as never;
    t.ctx.access.close({ code: CODE });
    await push.notifyHandoff(chat);
    expect(emit).not.toHaveBeenCalled();
    t.ctx.access.open();
    await push.notifyHandoff(chat);
    expect(emit).toHaveBeenCalled();
    delete t.ctx.services.realtime;
  });
});

describe('host-only extension routes (/api/ext/<name>/host/…)', () => {
  it('answer a direct loopback client with a loopback Host, without a session', async () => {
    t = await makeTestApp({ extensions: [licensing()] });
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/ext/lic/host/status',
      headers: { host: '127.0.0.1:7420' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ host: true });
    const post = await t.app.inject({
      method: 'POST',
      url: '/api/ext/lic/host/activate',
      headers: { host: 'localhost' },
    });
    expect(post.statusCode).toBe(200);
  });

  it('reject the tunnel (CF-Connecting-IP), LAN peers and non-loopback Host names', async () => {
    t = await makeTestApp({ extensions: [licensing()] });
    const cases = [
      { headers: { host: 'localhost', 'cf-connecting-ip': '203.0.113.9' } },
      { headers: { host: '192.168.1.5:7420' } },
      { headers: { host: 'office-pc' } },
      { headers: { host: 'localhost' }, remoteAddress: '192.168.1.20' },
    ];
    for (const c of cases) {
      const res = await t.app.inject({ method: 'GET', url: '/api/ext/lic/host/status', ...c });
      expect(res.statusCode, JSON.stringify(c)).toBe(403);
    }
    const encoded = await t.app.inject({
      method: 'GET',
      url: '/api/ext/lic/%68ost/status',
      headers: { host: 'localhost', 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(encoded.statusCode).not.toBe(200);
  });

  it('keep working while the gate is closed; other extension routes are gated', async () => {
    t = await makeTestApp({ extensions: [licensing()] });
    t.ctx.access.close({ code: CODE });
    const host = await t.app.inject({
      method: 'GET',
      url: '/api/ext/lic/host/status',
      headers: { host: 'localhost' },
    });
    expect(host.statusCode).toBe(200);
    const viaTunnel = await t.app.inject({
      method: 'GET',
      url: '/api/ext/lic/host/status',
      headers: { host: 'localhost', 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(viaTunnel.statusCode).toBe(403);
    const other = await t.app.inject({
      method: 'GET',
      url: '/api/ext/lic/info',
      headers: { host: 'localhost' },
    });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toEqual({ error: CODE });
    t.ctx.access.open();
    const reopened = await t.app.inject({
      method: 'GET',
      url: '/api/ext/lic/info',
      headers: { host: 'localhost' },
    });
    expect(reopened.statusCode).toBe(200);
  });
});

describe('access gate and Socket.IO', () => {
  function connect(cookie: string): ClientSocket {
    const s: ClientSocket = ioClient(t!.url!, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { cookie },
      forceNew: true,
    });
    sockets.push(s);
    return s;
  }

  it('tells connected clients the code, disconnects them and refuses new ones', async () => {
    t = await makeTestApp({ listen: true });
    const { cookie } = await createUserAndLogin(t);
    const s = connect(cookie);
    await new Promise<void>((resolve, reject) => {
      s.once('connect', () => resolve());
      s.once('connect_error', reject);
    });
    const got = new Promise<{ code: string }>((resolve) => s.once('access:closed', resolve));
    const dropped = new Promise<void>((resolve) => s.once('disconnect', () => resolve()));
    t.ctx.access.close({ code: CODE });
    expect(await got).toEqual({ code: CODE });
    await dropped;

    const again = connect(cookie);
    const err = await new Promise<Error>((resolve) => again.once('connect_error', resolve));
    expect(err.message).toBe(CODE);
  });
});

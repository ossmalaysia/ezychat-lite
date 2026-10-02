import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserSchema } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin, sessionCookieFrom } from './auth-helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const admin = { username: 'boss', displayName: 'The Boss', password: 'supersecret1' };

describe('setup', () => {
  it('status is true then false after admin created', async () => {
    let r = await t.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ needsSetup: true });

    r = await t.app.inject({ method: 'POST', url: '/api/setup/admin', payload: admin });
    expect(r.statusCode).toBe(200);
    const user = UserSchema.parse(r.json());
    expect(user.role).toBe('admin');
    expect(user.mustChangePassword).toBe(false);
    expect(sessionCookieFrom(r)).not.toBeNull();

    r = await t.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(r.json()).toEqual({ needsSetup: false });

    const row = t.ctx.db.prepare("SELECT * FROM audit_log WHERE action = 'setup.admin'").get();
    expect(row).toBeTruthy();
  });

  it('setup cookie authenticates /api/me', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/setup/admin', payload: admin });
    const cookie = sessionCookieFrom(r)!;
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('boss');
  });

  it('rejects setup from a non-loopback peer', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      payload: admin,
      remoteAddress: '10.1.1.1',
    });
    expect(r.statusCode).toBe(403);
    expect(t.ctx.services.auth!.hasAnyUser()).toBe(false);
  });

  it('rejects setup arriving through the tunnel (cf-connecting-ip)', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      payload: admin,
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(r.statusCode).toBe(403);
    expect(t.ctx.services.auth!.hasAnyUser()).toBe(false);
  });

  it('second setup returns 404', async () => {
    await t.app.inject({ method: 'POST', url: '/api/setup/admin', payload: admin });
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      payload: { ...admin, username: 'other' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('validates the setup body', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      payload: { ...admin, password: 'short' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('login', () => {
  it('ok sets an HttpOnly SameSite=Lax cookie and audits', async () => {
    t.ctx.services.auth!.createUser({ username: 'amy', displayName: 'Amy', role: 'agent', password: 'password123', mustChangePassword: false });
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'AMY', password: 'password123' } });
    expect(r.statusCode).toBe(200);
    expect(UserSchema.parse(r.json()).username).toBe('amy');
    const sc = String(r.headers['set-cookie']);
    expect(sc).toMatch(/^sid=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
    expect(sc).not.toMatch(/Secure/i);
    // DB stores the hash, not the raw token
    const raw = sessionCookieFrom(r)!.slice(4);
    const rows = t.ctx.db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(rows.some((x) => x.token_hash === raw)).toBe(false);
    expect(t.ctx.db.prepare("SELECT 1 FROM audit_log WHERE action='auth.login'").get()).toBeTruthy();
  });

  it('sets Secure cookie when HTTPS via loopback proxy', async () => {
    t.ctx.services.auth!.createUser({ username: 'amy', displayName: 'Amy', role: 'agent', password: 'password123', mustChangePassword: false });
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'amy', password: 'password123' },
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(String(r.headers['set-cookie'])).toMatch(/Secure/i);
  });

  it('wrong password returns 401 and audits failure', async () => {
    t.ctx.services.auth!.createUser({ username: 'amy', displayName: 'Amy', role: 'agent', password: 'password123', mustChangePassword: false });
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'amy', password: 'nope' } });
    expect(r.statusCode).toBe(401);
    expect(t.ctx.db.prepare("SELECT 1 FROM audit_log WHERE action='auth.login_failed'").get()).toBeTruthy();
  });

  it('5 wrong passwords lock the account: 6th returns 429 even with correct password', async () => {
    t.ctx.services.auth!.createUser({ username: 'amy', displayName: 'Amy', role: 'agent', password: 'password123', mustChangePassword: false });
    for (let i = 0; i < 5; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'amy', password: 'wrong' },
        remoteAddress: `10.0.0.${i + 1}`,
      });
      expect(r.statusCode).toBe(401);
    }
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'amy', password: 'password123' },
      remoteAddress: '10.0.0.50',
    });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('rate_limited');
    expect(r.headers['retry-after']).toBeDefined();
  });

  it('spoofed cf-connecting-ip from a non-loopback peer does not bypass the IP limit', async () => {
    for (let i = 0; i < 20; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: `ghost${i}`, password: 'x' },
        remoteAddress: '10.9.9.9',
        headers: { 'cf-connecting-ip': `198.51.100.${i}` },
      });
      expect(r.statusCode).toBe(401);
    }
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost99', password: 'x' },
      remoteAddress: '10.9.9.9',
      headers: { 'cf-connecting-ip': '198.51.100.250' },
    });
    expect(r.statusCode).toBe(429);
  });

  it('cf-connecting-ip from loopback (tunnel) is used as the rate-limit key', async () => {
    for (let i = 0; i < 20; i++) {
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: `ghost${i}`, password: 'x' },
        headers: { 'cf-connecting-ip': '198.51.100.7' },
      });
    }
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghostz', password: 'x' },
      headers: { 'cf-connecting-ip': '198.51.100.8' },
    });
    expect(other.statusCode).toBe(401);
  });

  it('disabled user cannot log in', async () => {
    const u = t.ctx.services.auth!.createUser({ username: 'amy', displayName: 'Amy', role: 'agent', password: 'password123', mustChangePassword: false });
    t.ctx.services.auth!.createUser({ username: 'root', displayName: 'Root', role: 'admin', password: 'password123', mustChangePassword: false });
    t.ctx.services.auth!.updateUser(u.id, { disabled: true }, u.id + 1);
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'amy', password: 'password123' } });
    expect(r.statusCode).toBe(401);
  });
});

describe('session', () => {
  it('GET /api/me without cookie → 401', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('unauthorized');
  });

  it('logout destroys the session', async () => {
    const { cookie } = await createUserAndLogin(t);
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: authHeaders(cookie) });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/sid=;/);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('disabled user existing cookie → 401', async () => {
    const { cookie, user } = await createUserAndLogin(t, { role: 'agent' });
    const { user: adm } = await createUserAndLogin(t, { role: 'admin' });
    t.ctx.services.auth!.updateUser(user.id, { disabled: true }, adm.id);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('expires after 30 days idle', async () => {
    const { cookie } = await createUserAndLogin(t);
    t.ctx.db.prepare('UPDATE sessions SET last_seen_at = ?').run(Date.now() - 31 * 24 * 3600 * 1000);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    expect((t.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
  });

  it('mutating request with cookie but foreign origin → 403', async () => {
    const { cookie } = await createUserAndLogin(t);
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'http://evil.example', host: 'localhost' },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('change password', () => {
  it('must_change_password blocks guarded routes until changed', async () => {
    const { cookie, password, user } = await createUserAndLogin(t, { role: 'admin' });
    t.ctx.db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);

    let r = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(r.statusCode).toBe(403);
    r = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().mustChangePassword).toBe(true);

    r = await t.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(cookie),
      payload: { currentPassword: 'bad-current', newPassword: 'brandnewpass' },
    });
    expect(r.statusCode).toBe(400);

    r = await t.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(cookie),
      payload: { currentPassword: password, newPassword: 'brandnewpass' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mustChangePassword).toBe(false);

    r = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(r.statusCode).toBe(200);

    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: user.username, password: 'brandnewpass' },
      remoteAddress: '10.3.3.3',
    });
    expect(login.statusCode).toBe(200);
  });

  it('change password revokes other sessions but keeps the current one', async () => {
    const { cookie, password, user } = await createUserAndLogin(t);
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: user.username, password },
      remoteAddress: '10.4.4.4',
    });
    const otherCookie = sessionCookieFrom(other)!;
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(cookie),
      payload: { currentPassword: password, newPassword: 'anotherpass1' },
    });
    expect(r.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: otherCookie } })).statusCode).toBe(401);
  });
});

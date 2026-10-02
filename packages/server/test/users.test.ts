import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResetPasswordResponse, UserSchema } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('users (admin)', () => {
  it('agent → /api/users 403', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const r = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(r.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/users' });
    expect(r.statusCode).toBe(401);
  });

  it('admin lists and creates users; new user must change password', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    let r = await t.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(cookie),
      payload: { username: 'newbie', displayName: 'New Bie', role: 'agent', password: 'temppass123' },
    });
    expect(r.statusCode).toBe(201);
    const created = UserSchema.parse(r.json());
    expect(created.mustChangePassword).toBe(true);

    r = await t.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(cookie),
      payload: { username: 'NEWBIE', displayName: 'Dup', role: 'agent', password: 'temppass123' },
    });
    expect(r.statusCode).toBe(409);

    r = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const list = r.json().users as unknown[];
    expect(list.map((u) => UserSchema.parse(u).username)).toContain('newbie');
    expect(JSON.stringify(r.json())).not.toContain('password');
    expect(t.ctx.db.prepare("SELECT 1 FROM audit_log WHERE action='user.create'").get()).toBeTruthy();
  });

  it('cannot disable or demote the last active admin → 409', async () => {
    const { cookie, user } = await createUserAndLogin(t, { role: 'admin' });
    let r = await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: authHeaders(cookie),
      payload: { disabled: true },
    });
    expect(r.statusCode).toBe(409);
    r = await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: authHeaders(cookie),
      payload: { role: 'agent' },
    });
    expect(r.statusCode).toBe(409);
  });

  it('admin can disable an agent; agent session dies immediately and bus events fire', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const disabled: number[] = [];
    const revoked: number[] = [];
    t.ctx.bus.on('user:disabled', (id) => disabled.push(id));
    t.ctx.bus.on('user:sessions-revoked', (id) => revoked.push(id));
    const r = await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${agent.user.id}`,
      headers: authHeaders(cookie),
      payload: { disabled: true, displayName: 'Gone' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().disabled).toBe(true);
    expect(r.json().displayName).toBe('Gone');
    expect(disabled).toEqual([agent.user.id]);
    expect(revoked).toEqual([agent.user.id]);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: agent.cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('PATCH unknown user → 404', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const r = await t.app.inject({
      method: 'PATCH',
      url: '/api/users/9999',
      headers: authHeaders(cookie),
      payload: { displayName: 'x' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('reset-password returns a new password and invalidates old sessions', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/users/${agent.user.id}/reset-password`,
      headers: authHeaders(cookie),
    });
    expect(r.statusCode).toBe(200);
    const { password } = ResetPasswordResponse.parse(r.json());
    expect(password).toHaveLength(12);

    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: agent.cookie } });
    expect(me.statusCode).toBe(401);

    const oldLogin = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: agent.user.username, password: agent.password },
      remoteAddress: '10.5.5.5',
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: agent.user.username, password },
      remoteAddress: '10.5.5.6',
    });
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json().mustChangePassword).toBe(true);
  });

  it('DELETE /users/:id/sessions revokes sessions', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const r = await t.app.inject({
      method: 'DELETE',
      url: `/api/users/${agent.user.id}/sessions`,
      headers: authHeaders(cookie),
    });
    expect(r.statusCode).toBe(200);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: agent.cookie } });
    expect(me.statusCode).toBe(401);
    expect(t.ctx.db.prepare("SELECT 1 FROM audit_log WHERE action='user.revoke_sessions'").get()).toBeTruthy();
  });
});

describe('resetFirstAdmin', () => {
  it('sets a new password, forces change, revokes sessions', async () => {
    const { resetFirstAdmin } = await import('../src/auth/reset.js');
    const adm = await createUserAndLogin(t, { role: 'admin' });
    const { username, password } = resetFirstAdmin(t.ctx.db);
    expect(username).toBe(adm.user.username);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: adm.cookie } });
    expect(me.statusCode).toBe(401);
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
      remoteAddress: '10.6.6.6',
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().mustChangePassword).toBe(true);
  });
});

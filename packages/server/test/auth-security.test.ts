import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as passwords from '../src/auth/passwords.js';
import { authHeaders, createUserAndLogin, sessionCookieFrom } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;

async function resetPassword(userId: number): Promise<string> {
  const admin = await createUserAndLogin(t, { role: 'admin' });
  return t.ctx.services.auth!.resetPassword(userId, admin.cookie.slice('sid='.length));
}

beforeEach(async () => {
  t = await makeTestApp();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

/** Hold one real Argon2 operation while another request changes security state. */
function pausePasswordOperation(operation: 'hashPassword' | 'verifyPassword') {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (operation === 'hashPassword') {
    const original = passwords.hashPassword;
    vi.spyOn(passwords, operation).mockImplementationOnce(async (password) => {
      entered();
      await blocked;
      return original(password);
    });
  } else {
    const original = passwords.verifyPassword;
    vi.spyOn(passwords, operation).mockImplementationOnce(async (hash, password) => {
      entered();
      await blocked;
      return original(hash, password);
    });
  }
  return { started, release };
}

describe('authentication security races', () => {
  it('does not create a session for an old password when reset occurs during verification', async () => {
    const account = await createUserAndLogin(t);
    const barrier = pausePasswordOperation('verifyPassword');
    const pending = t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: account.user.username, password: account.password },
    });
    await barrier.started;
    const temporaryPassword = await resetPassword(account.user.id);
    barrier.release();
    const response = await pending;
    expect(response.statusCode).toBe(401);
    expect(sessionCookieFrom(response)).toBeNull();
    expect(
      t.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(account.user.id),
    ).toEqual({ n: 0 });
    await expect(
      t.ctx.services.auth!.login(account.user.username, temporaryPassword, {
        ip: '10.0.0.2',
        userAgent: '',
      }),
    ).resolves.toMatchObject({ user: { mustChangePassword: true } });
  });

  it('does not create a session if the account is disabled during verification', async () => {
    const account = await createUserAndLogin(t);
    const barrier = pausePasswordOperation('verifyPassword');
    const pending = t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: account.user.username, password: account.password },
    });
    await barrier.started;
    t.ctx.services.auth!.updateUser(account.user.id, { disabled: true }, account.user.id + 1);
    barrier.release();
    expect((await pending).statusCode).toBe(401);
  });

  it('does not overwrite an admin reset with an in-flight password change', async () => {
    const account = await createUserAndLogin(t);
    const barrier = pausePasswordOperation('hashPassword');
    const pending = t.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(account.cookie),
      payload: { currentPassword: account.password, newPassword: 'attacker-password123' },
    });
    await barrier.started;
    const temporaryPassword = await resetPassword(account.user.id);
    barrier.release();
    expect((await pending).statusCode).toBe(401);
    await expect(
      t.ctx.services.auth!.login(account.user.username, temporaryPassword, {
        ip: '10.0.0.2',
        userAgent: '',
      }),
    ).resolves.toMatchObject({ user: { mustChangePassword: true } });
    await expect(
      t.ctx.services.auth!.login(account.user.username, 'attacker-password123', {
        ip: '10.0.0.3',
        userAgent: '',
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('does not change a password after its authorizing session was revoked', async () => {
    const account = await createUserAndLogin(t);
    const barrier = pausePasswordOperation('hashPassword');
    const pending = t.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(account.cookie),
      payload: { currentPassword: account.password, newPassword: 'attacker-password123' },
    });
    await barrier.started;
    t.ctx.services.auth!.revokeAll(account.user.id);
    barrier.release();
    expect((await pending).statusCode).toBe(401);
    await expect(
      t.ctx.services.auth!.login(account.user.username, account.password, {
        ip: '10.0.0.2',
        userAgent: '',
      }),
    ).resolves.toMatchObject({ user: { id: account.user.id } });
  });

  it.each(['revoke', 'demote'] as const)(
    'does not complete a privileged password reset after the initiating admin is %s',
    async (action) => {
      const actor = await createUserAndLogin(t, { role: 'admin' });
      const target = await createUserAndLogin(t, { role: 'admin' });
      const barrier = pausePasswordOperation('hashPassword');
      const pending = t.app.inject({
        method: 'POST',
        url: `/api/users/${target.user.id}/reset-password`,
        headers: authHeaders(actor.cookie),
      });
      await barrier.started;
      if (action === 'revoke') t.ctx.services.auth!.revokeAll(actor.user.id);
      else t.ctx.services.auth!.updateUser(actor.user.id, { role: 'agent' }, target.user.id);
      barrier.release();
      const response = await pending;
      expect(response.statusCode).toBe(action === 'revoke' ? 401 : 403);
      expect(response.json()).not.toHaveProperty('password');
      await expect(
        t.ctx.services.auth!.login(target.user.username, target.password, {
          ip: '10.0.0.3',
          userAgent: '',
        }),
      ).resolves.toMatchObject({ user: { mustChangePassword: false } });
    },
  );
});

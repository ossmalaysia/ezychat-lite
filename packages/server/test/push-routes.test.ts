import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('push routes', () => {
  it('vapid-key requires auth and returns the public key', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/push/vapid-key' })).statusCode).toBe(401);
    const { cookie } = await createUserAndLogin(t);
    const res = await t.app.inject({ method: 'GET', url: '/api/push/vapid-key', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toBe(t.ctx.services.push!.publicKey());
  });

  it('subscribe validates body, stores, and unsubscribes', async () => {
    const { cookie, user } = await createUserAndLogin(t);
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: authHeaders(cookie),
      payload: { endpoint: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data',
      'https://192.168.1.1/admin',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://internal.example.com/hook',
      'https://localhost/x',
    ]) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: authHeaders(cookie),
        payload: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
      });
      expect(r.statusCode, endpoint).toBe(400);
    }
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
    const body = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'p', auth: 'a' } };
    const ok = await t.app.inject({ method: 'POST', url: '/api/push/subscribe', headers: authHeaders(cookie), payload: body });
    expect(ok.statusCode).toBe(200);
    expect(t.ctx.db.prepare('SELECT user_id FROM push_subscriptions').all()).toEqual([{ user_id: user.id }]);
    const del = await t.app.inject({
      method: 'DELETE',
      url: '/api/push/subscribe',
      headers: authHeaders(cookie),
      payload: { endpoint: body.endpoint },
    });
    expect(del.statusCode).toBe(200);
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
  });
});

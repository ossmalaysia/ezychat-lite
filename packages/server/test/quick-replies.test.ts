import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuickReplySchema } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('quick replies', () => {
  it('agent can read but write → 403', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    let r = await t.app.inject({ method: 'GET', url: '/api/quick-replies', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().quickReplies).toEqual([]);
    r = await t.app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: authHeaders(cookie),
      payload: { shortcut: 'hi', body: 'Hello!' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('admin CRUD; duplicate shortcut → 409; invalid shortcut → 400', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    let r = await t.app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: authHeaders(cookie),
      payload: { shortcut: 'hi', body: 'Hello!' },
    });
    expect(r.statusCode).toBe(201);
    const qr = QuickReplySchema.parse(r.json());

    r = await t.app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: authHeaders(cookie),
      payload: { shortcut: 'hi', body: 'again' },
    });
    expect(r.statusCode).toBe(409);

    r = await t.app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: authHeaders(cookie),
      payload: { shortcut: 'Hello World', body: 'x' },
    });
    expect(r.statusCode).toBe(400);

    r = await t.app.inject({
      method: 'PATCH',
      url: `/api/quick-replies/${qr.id}`,
      headers: authHeaders(cookie),
      payload: { body: 'Hello, how can we help?' },
    });
    expect(r.statusCode).toBe(200);
    expect(QuickReplySchema.parse(r.json()).body).toBe('Hello, how can we help?');

    r = await t.app.inject({ method: 'GET', url: '/api/quick-replies', headers: { cookie } });
    expect(r.json().quickReplies.length).toBe(1);

    r = await t.app.inject({ method: 'DELETE', url: `/api/quick-replies/${qr.id}`, headers: authHeaders(cookie) });
    expect(r.statusCode).toBe(200);
    r = await t.app.inject({ method: 'DELETE', url: `/api/quick-replies/${qr.id}`, headers: authHeaders(cookie) });
    expect(r.statusCode).toBe(404);
  });
});

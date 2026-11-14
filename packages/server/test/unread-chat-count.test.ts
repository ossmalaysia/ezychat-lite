// App navigation (docs/features/app-navigation/design.md): the Chats count is the number of open chats with unread
// messages that the signed-in user may open, in the same scope as GET /api/chats.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnreadChatCountResponse, type User } from '@ezychat/shared';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const A = '60123000111@s.whatsapp.net';
const B = '60123000222@s.whatsapp.net';
const G = '120363000000000001@g.us';
const MEMBER = '60175550001@s.whatsapp.net';
const enc = encodeURIComponent;

const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

let t: TestApp;
let admin: { user: User; cookie: string };
let agent: { user: User; cookie: string };

async function seed(app: TestApp, inboxId = 1) {
  const wa = app.inboxWa(inboxId);
  wa.simulateIncoming({ chatJid: A, body: 'hello A', senderName: 'Ann' });
  wa.simulateIncoming({ chatJid: B, body: 'hello B', senderName: 'Bob' });
  wa.simulateIncoming({ chatJid: G, body: 'group hi', senderJid: MEMBER, senderName: 'Ben' });
  await settle();
}

function inject(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  payload?: object,
) {
  return t.app.inject({
    method,
    url,
    headers: authHeaders(cookie),
    ...(payload ? { payload } : {}),
  });
}

async function count(cookie: string): Promise<number> {
  const res = await inject('GET', '/api/chats/unread-count', cookie);
  expect(res.statusCode).toBe(200);
  return UnreadChatCountResponse.parse(res.json()).count;
}

beforeEach(async () => {
  t = await makeTestApp();
  admin = await createUserAndLogin(t, { role: 'admin' });
  agent = await createUserAndLogin(t);
  await seed(t);
});
afterEach(async () => {
  await t.close();
});

describe('GET /api/chats/unread-count', () => {
  it('needs a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/chats/unread-count' });
    expect(res.statusCode).toBe(401);
  });

  it('counts open chats with unread messages, groups included; reading or resolving a chat lowers it', async () => {
    expect(await count(admin.cookie)).toBe(3);
    expect(await count(agent.cookie)).toBe(3);
    // a second message in the same chat is still one chat
    t.inboxWa(1).simulateIncoming({ chatJid: A, body: 'again', senderName: 'Ann' });
    await settle();
    expect(await count(admin.cookie)).toBe(3);
    // unread counts are shared by the team: one person reading clears it for everyone
    expect((await inject('POST', `/api/chats/${enc(A)}/read`, agent.cookie)).statusCode).toBe(200);
    expect(await count(admin.cookie)).toBe(2);
    const resolved = await inject('PATCH', `/api/chats/${enc(B)}`, admin.cookie, {
      status: 'resolved',
    });
    expect(resolved.statusCode).toBe(200);
    expect(await count(agent.cookie)).toBe(1);
  });

  it('leaves out the chats hidden on Log out: they open for nobody', async () => {
    expect(await count(admin.cookie)).toBe(3);
    expect((await inject('POST', '/api/wa/logout', admin.cookie)).statusCode).toBe(200);
    await settle();
    expect(await count(admin.cookie)).toBe(0);
    expect(await count(agent.cookie)).toBe(0);
  });

  it('an agent limited to chosen chats counts only those; none chosen counts none', async () => {
    const put = (chats: string[]) =>
      inject('PUT', `/api/users/${agent.user.id}/chats`, admin.cookie, { scope: 'chosen', chats });
    expect((await put([A, G])).statusCode).toBe(200);
    expect(await count(agent.cookie)).toBe(2);
    expect((await put([])).statusCode).toBe(200);
    expect(await count(agent.cookie)).toBe(0);
    expect(await count(admin.cookie)).toBe(3);
  });

  it('several inboxes: an agent counts only the inboxes they may open; admins count every inbox', async () => {
    await t.close();
    t = await makeTestApp({ maxInboxes: 3, inboxes: 2 });
    admin = await createUserAndLogin(t, { role: 'admin' });
    agent = await createUserAndLogin(t);
    await seed(t, 1);
    await seed(t, 2);
    expect(await count(admin.cookie)).toBe(6);
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [2]);
    expect(await count(agent.cookie)).toBe(3);
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, []);
    expect(await count(agent.cookie)).toBe(0);
    // a removed inbox keeps its chats read only: nobody can answer them, so they leave the count
    expect((await inject('DELETE', '/api/inboxes/2', admin.cookie)).statusCode).toBe(204);
    expect(await count(admin.cookie)).toBe(3);
  });
});

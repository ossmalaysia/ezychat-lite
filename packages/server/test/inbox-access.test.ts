import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatListResponse, User } from '@ezychat/shared';
import { createAgentRow } from '../src/ai/agents.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const C = '60123000111@s.whatsapp.net';
const C2 = `${C}#2`;
const G = '120363000000000001@g.us';
const G2 = `${G}#2`;
const MEMBER = '60175550001@s.whatsapp.net';
const enc = encodeURIComponent;

const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

let t: TestApp;
let admin: { user: User; cookie: string };
let agent: { user: User; cookie: string };

beforeEach(async () => {
  t = await makeTestApp({ maxInboxes: 3, inboxes: 2 });
  admin = await createUserAndLogin(t, { role: 'admin' });
  agent = await createUserAndLogin(t);
  t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [1]);
  for (const id of [1, 2]) {
    t.inboxWa(id).simulateIncoming({ chatJid: C, body: `hello ${id}`, senderName: 'Ann' });
    t.inboxWa(id).simulateIncoming({
      chatJid: G,
      body: `group ${id}`,
      senderJid: MEMBER,
      senderName: 'Ben',
    });
  }
  await settle();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

const messageIdOf = (chatJid: string) =>
  (
    t.ctx.db
      .prepare('SELECT id FROM messages WHERE chat_jid = ? ORDER BY timestamp LIMIT 1')
      .get(chatJid) as { id: string }
  ).id;

interface Call {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  url: (key: string) => string;
  payload?: unknown;
  /** the chat this call works on in inbox 1 (inbox 2 is the same key with #2) */
  chat: 'dm' | 'group';
}

const chatCalls: Call[] = [
  { name: 'GET chat', method: 'GET', url: (k) => `/api/chats/${enc(k)}`, chat: 'dm' },
  {
    name: 'PATCH chat',
    method: 'PATCH',
    url: (k) => `/api/chats/${enc(k)}`,
    payload: { status: 'resolved' },
    chat: 'dm',
  },
  { name: 'read', method: 'POST', url: (k) => `/api/chats/${enc(k)}/read`, chat: 'dm' },
  { name: 'avatar', method: 'GET', url: (k) => `/api/chats/${enc(k)}/avatar`, chat: 'dm' },
  { name: 'messages', method: 'GET', url: (k) => `/api/chats/${enc(k)}/messages`, chat: 'dm' },
  {
    name: 'send',
    method: 'POST',
    url: (k) => `/api/chats/${enc(k)}/messages`,
    payload: { text: 'hi', clientId: 'c-1' },
    chat: 'dm',
  },
  {
    name: 'send media',
    method: 'POST',
    url: (k) => `/api/chats/${enc(k)}/media`,
    payload: {},
    chat: 'dm',
  },
  { name: 'notes', method: 'GET', url: (k) => `/api/chats/${enc(k)}/notes`, chat: 'dm' },
  {
    name: 'add note',
    method: 'POST',
    url: (k) => `/api/chats/${enc(k)}/notes`,
    payload: { body: 'note' },
    chat: 'dm',
  },
  { name: 'profile', method: 'GET', url: (k) => `/api/chats/${enc(k)}/profile`, chat: 'dm' },
  {
    name: 'save profile',
    method: 'PUT',
    url: (k) => `/api/chats/${enc(k)}/profile`,
    payload: { name: 'Ann', company: '', email: '', otherPhone: '', address: '', tags: [] },
    chat: 'dm',
  },
  { name: 'members', method: 'GET', url: (k) => `/api/chats/${enc(k)}/members`, chat: 'group' },
  {
    name: 'member about',
    method: 'GET',
    url: (k) => `/api/chats/${enc(k)}/members/${enc(MEMBER)}/about`,
    chat: 'group',
  },
  {
    name: 'member avatar',
    method: 'GET',
    url: (k) => `/api/chats/${enc(k)}/members/${enc(MEMBER)}/avatar`,
    chat: 'group',
  },
  {
    name: 'member chat',
    method: 'POST',
    url: (k) => `/api/chats/${enc(k)}/members/${enc(MEMBER)}/chat`,
    chat: 'group',
  },
];

function call(c: Call, key: string, cookie: string) {
  return t.app.inject({
    method: c.method,
    url: c.url(key),
    headers: authHeaders(cookie),
    ...(c.payload !== undefined ? { payload: c.payload as Record<string, unknown> } : {}),
  });
}

/** The group service calls WhatsApp; keep them local so only the access check is under test. */
function stubGroups() {
  const groups = t.ctx.services.groups!;
  return {
    info: vi.spyOn(groups, 'info').mockResolvedValue({} as never),
    about: vi.spyOn(groups, 'about').mockResolvedValue(null),
    photoTarget: vi
      .spyOn(groups, 'photoTarget')
      .mockResolvedValue({ jid: MEMBER, key: MEMBER } as never),
    startChat: vi.spyOn(groups, 'startChat').mockResolvedValue(C),
  };
}

describe('inbox access on per-chat routes (RF-3)', () => {
  it.each(chatCalls)('$name: an agent of inbox 1 gets 404 for an inbox 2 chat', async (c) => {
    const spies = stubGroups();
    const key2 = c.chat === 'dm' ? C2 : G2;
    const res = await call(c, key2, agent.cookie);
    expect(res.statusCode).toBe(404);
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    // nothing about the chat leaks in the answer
    expect(res.body).not.toContain('Ann');
  });

  it.each(chatCalls)('$name: the agent still opens the inbox 1 chat', async (c) => {
    stubGroups();
    const res = await call(c, c.chat === 'dm' ? C : G, agent.cookie);
    expect(res.statusCode).not.toBe(404);
  });

  it.each(chatCalls)('$name: an admin opens the inbox 2 chat', async (c) => {
    stubGroups();
    const res = await call(c, c.chat === 'dm' ? C2 : G2, admin.cookie);
    expect(res.statusCode).not.toBe(404);
  });

  it('a malformed chat key answers 404, never 500', async () => {
    for (const key of [`${C}#1`, `${C}#x`, `${C}#2#3`, `${C}#9`]) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/chats/${enc(key)}`,
        headers: authHeaders(admin.cookie),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('a key the chat service cannot resolve answers 404', async () => {
    vi.spyOn(getChats(t.ctx), 'resolveJid').mockImplementation(() => {
      throw new Error('invalid chat key');
    });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(C)}/notes`,
      headers: authHeaders(admin.cookie),
    });
    expect(res.statusCode).toBe(404);
  });

  it('message-id routes look up the chat first: 404 for an inbox 2 message', async () => {
    const messages = getMessages(t.ctx);
    const ensure = vi.spyOn(messages, 'ensureMedia');
    const redownload = vi.spyOn(messages, 'redownload');
    const retry = vi.spyOn(messages, 'retry');
    const id2 = messageIdOf(C2);
    expect(id2).toMatch(/#2$/);
    for (const [method, url] of [
      ['GET', `/api/media/${enc(id2)}`],
      ['POST', `/api/media/${enc(id2)}/redownload`],
      ['POST', `/api/messages/${enc(id2)}/retry`],
    ] as const) {
      const res = await t.app.inject({ method, url, headers: authHeaders(agent.cookie) });
      expect(res.statusCode, url).toBe(404);
    }
    expect(ensure).not.toHaveBeenCalled();
    expect(redownload).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();

    // an admin reaches the message service (retry refuses a message that did not fail)
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/messages/${enc(id2)}/retry`,
      headers: authHeaders(admin.cookie),
    });
    expect(res.statusCode).toBe(409);
    expect(retry).toHaveBeenCalledOnce();
    await t.app.inject({
      method: 'GET',
      url: `/api/media/${enc(id2)}`,
      headers: authHeaders(admin.cookie),
    });
    expect(ensure).toHaveBeenCalledWith(id2);
    // the agent's own inbox works
    await t.app.inject({
      method: 'GET',
      url: `/api/media/${enc(messageIdOf(C))}`,
      headers: authHeaders(agent.cookie),
    });
    expect(ensure).toHaveBeenCalledWith(messageIdOf(C));
    // an unknown message stays 404 for everyone
    const unknown = await t.app.inject({
      method: 'POST',
      url: `/api/messages/nope/retry`,
      headers: authHeaders(admin.cookie),
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('a pending send is found by its local id', async () => {
    const sent = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(C2)}/messages`,
      headers: authHeaders(admin.cookie),
      payload: { text: 'hi', clientId: 'local-check' },
    });
    expect(sent.statusCode).toBe(201);
    const ensure = vi.spyOn(getMessages(t.ctx), 'ensureMedia');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/media/local-local-check`,
      headers: authHeaders(agent.cookie),
    });
    expect(res.statusCode).toBe(404);
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('chat list scope (RF-3)', () => {
  const list = async (cookie: string, query = '') => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/chats${query}`,
      headers: authHeaders(cookie),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as ChatListResponse).chats.map((c) => c.jid).sort();
  };

  it('never returns an inbox 2 chat to an agent of inbox 1, also with q and tag', async () => {
    await t.app.inject({
      method: 'PUT',
      url: `/api/chats/${enc(C2)}/profile`,
      headers: authHeaders(admin.cookie),
      payload: { name: 'Ann', company: '', email: '', otherPhone: '', address: '', tags: ['vip'] },
    });
    await t.app.inject({
      method: 'PUT',
      url: `/api/chats/${enc(C)}/profile`,
      headers: authHeaders(admin.cookie),
      payload: { name: 'Ann', company: '', email: '', otherPhone: '', address: '', tags: ['vip'] },
    });
    expect(await list(agent.cookie)).toEqual([C, G].sort());
    expect(await list(agent.cookie, '?q=Ann')).toEqual([C]);
    expect(await list(agent.cookie, '?tag=vip')).toEqual([C]);
    expect(await list(agent.cookie, '?inbox=2')).toEqual([]);
    expect(await list(admin.cookie)).toEqual([C, C2, G, G2].sort());
    expect(await list(admin.cookie, '?tag=vip')).toEqual([C, C2].sort());
    expect(await list(admin.cookie, '?inbox=2')).toEqual([C2, G2].sort());
  });

  it('an agent with no inbox sees no chat', async () => {
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, []);
    expect(await list(agent.cookie)).toEqual([]);
  });

  it('rejects an invalid inbox filter', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/chats?inbox=0',
      headers: authHeaders(admin.cookie),
    });
    expect(res.statusCode).toBe(400);
  });

  it('customer tags used only in inbox 2 are not suggested to the agent', async () => {
    const save = (key: string, tags: string[]) =>
      t.app.inject({
        method: 'PUT',
        url: `/api/chats/${enc(key)}/profile`,
        headers: authHeaders(admin.cookie),
        payload: { name: 'Ann', company: '', email: '', otherPhone: '', address: '', tags },
      });
    expect((await save(C, ['shared'])).statusCode).toBe(200);
    expect((await save(C2, ['shared', 'secret'])).statusCode).toBe(200);
    const tags = async (cookie: string) =>
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/customer-tags',
          headers: authHeaders(cookie),
        })
      ).json() as { tags: string[] };
    expect((await tags(agent.cookie)).tags).toEqual(['shared']);
    expect((await tags(admin.cookie)).tags.sort()).toEqual(['secret', 'shared']);
  });
});

describe('GET /wa/status (RF-3)', () => {
  const status = (cookie: string) =>
    t.app.inject({ method: 'GET', url: '/api/wa/status', headers: authHeaders(cookie) });

  beforeEach(() => {
    t.wa.simulateStatus({ me: { jid: '60111222333:4@s.whatsapp.net', name: 'Shop' } });
  });

  it('an agent without inbox 1 gets a neutral status: no number, no QR', async () => {
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [2]);
    const res = await status(agent.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'logged_out', me: null, qr: null, lastError: null });
    expect(res.body).not.toContain('60111222333');
  });

  it('an agent of inbox 1 and an admin get its real status', async () => {
    expect((await status(agent.cookie)).json().me?.jid).toBe('60111222333:4@s.whatsapp.net');
    expect((await status(admin.cookie)).json().me?.jid).toBe('60111222333:4@s.whatsapp.net');
  });
});

describe('assignment (RF-3)', () => {
  it('refuses an assignee who cannot open the chat inbox', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(C2)}`,
      headers: authHeaders(admin.cookie),
      payload: { assignedTo: agent.user.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('assignee_no_access');
    expect(getChats(t.ctx).get(C2)!.assignedTo).toBeNull();
  });

  it('accepts an agent of the inbox, an admin and the AI member', async () => {
    const ok = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(C)}`,
      headers: authHeaders(admin.cookie),
      payload: { assignedTo: agent.user.id },
    });
    expect(ok.statusCode).toBe(200);
    const toAdmin = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(C2)}`,
      headers: authHeaders(admin.cookie),
      payload: { assignedTo: admin.user.id },
    });
    expect(toAdmin.statusCode).toBe(200);
    addAiMember(t, 2); // an AI member owns chats only as its inbox's agent
    const ai = t.ctx.services.auth!.listUsers().find((u) => u.kind === 'ai');
    expect(ai).toBeDefined();
    {
      const toAi = getChats(t.ctx).patch(C2, { assignedTo: ai!.id }, admin.user.id);
      expect(toAi.assignedTo).toBe(ai!.id);
    }
  });
});

/** The Sales Agent member (created on demand in the app; directly here), the agent of `inboxId`. */
function addAiMember(app: TestApp, inboxId: number): number {
  const u = app.ctx.services.auth!.createUser({
    username: 'sales-ai',
    displayName: 'Sales Agent',
    role: 'agent',
    password: 'password123',
    mustChangePassword: false,
  });
  app.ctx.db.prepare("UPDATE users SET kind = 'ai' WHERE id = ?").run(u.id);
  createAgentRow(app.ctx.db, {
    userId: u.id,
    inboxId,
    preset: 'sales',
    instructions: null,
    handoffRules: null,
  });
  return u.id;
}

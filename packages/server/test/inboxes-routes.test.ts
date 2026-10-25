import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DirectoryUserSchema,
  InboxListResponse,
  InboxSchema,
  UserSchema,
  type User,
} from '@ezychat/shared';
import { getChats } from '../src/wa-bridge/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const C = '60123000111@s.whatsapp.net';
const G = '120363000000000001@g.us';
const enc = encodeURIComponent;
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

async function app(opts: { maxInboxes?: number; inboxes?: number } = {}) {
  const t = await makeTestApp(opts);
  open.push(t);
  const admin = await createUserAndLogin(t, { role: 'admin' });
  const agent = await createUserAndLogin(t);
  const req = (cookie: string, method: string, url: string, payload?: unknown) =>
    t.app.inject({
      method: method as 'GET',
      url,
      headers: authHeaders(cookie),
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  return { t, admin, agent, req };
}

const auditRows = (t: TestApp, action: string) =>
  (
    t.ctx.db
      .prepare('SELECT user_id, meta FROM audit_log WHERE action = ? ORDER BY id')
      .all(action) as Array<{ user_id: number; meta: string }>
  ).map((r) => ({ userId: r.user_id, meta: JSON.parse(r.meta) as Record<string, unknown> }));

describe('Lite (one inbox)', () => {
  it('lists inbox 1 for everyone and refuses a second inbox with inbox_limit', async () => {
    const { t, admin, agent, req } = await app();
    t.wa.simulateStatus({ me: { jid: '60111222333:4@s.whatsapp.net', name: 'Shop' } });
    const forAdmin = InboxListResponse.parse(
      (await req(admin.cookie, 'GET', '/api/inboxes')).json(),
    );
    expect(forAdmin).toMatchObject({ maxInboxes: 1, canAdd: false });
    expect(forAdmin.inboxes).toHaveLength(1);
    expect(forAdmin.inboxes[0]).toMatchObject({ id: 1, number: '60111222333', removed: false });
    const forAgent = InboxListResponse.parse(
      (await req(agent.cookie, 'GET', '/api/inboxes')).json(),
    );
    expect(forAgent.inboxes.map((i) => i.id)).toEqual([1]);
    const res = await req(admin.cookie, 'POST', '/api/inboxes', { name: 'Support' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('inbox_limit');
    expect(t.ctx.inboxes.repo.list()).toHaveLength(1);
  });

  it('GET /users sends no inboxIds and a new agent joins the only inbox', async () => {
    const { t, admin, req } = await app();
    const created = await req(admin.cookie, 'POST', '/api/users', {
      username: 'newagent',
      displayName: 'New',
      role: 'agent',
      password: 'password123',
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as User).id;
    expect(t.ctx.inboxes.repo.userInboxIds(id)).toEqual([1]);
    const users = (await req(admin.cookie, 'GET', '/api/users')).json() as { users: User[] };
    for (const u of users.users) expect(u.inboxIds).toBeUndefined();
  });
});

describe('several inboxes', () => {
  it('creates inboxes in tone order, renames and round-trips members', async () => {
    const { t, admin, agent, req } = await app({ maxInboxes: 3 });
    const changed = vi.fn();
    t.ctx.bus.on('inboxes:changed', changed);
    const res = await req(admin.cookie, 'POST', '/api/inboxes', {
      name: '  Support ',
      memberIds: [agent.user.id],
    });
    expect(res.statusCode).toBe(201);
    const inbox = InboxSchema.parse(res.json());
    expect(inbox).toMatchObject({
      id: 2,
      name: 'Support',
      tone: 'warning',
      removed: false,
      memberIds: [agent.user.id],
      // the fake phone links at once
      number: '60000000002',
    });
    expect(t.inboxWa(2)).toBeTruthy();
    expect(changed).toHaveBeenCalled();
    const third = InboxSchema.parse(
      (await req(admin.cookie, 'POST', '/api/inboxes', { name: 'Billing' })).json(),
    );
    expect(third.tone).toBe('info');
    const full = await req(admin.cookie, 'POST', '/api/inboxes', { name: 'Four' });
    expect(full.json().error.code).toBe('inbox_limit');

    const renamed = await req(admin.cookie, 'PATCH', '/api/inboxes/2', { name: 'Help desk' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ id: 2, name: 'Help desk' });
    expect(auditRows(t, 'inbox.update').at(-1)!.meta).toEqual({ inboxId: 2, fields: ['name'] });

    // Members → Inbox access
    const put = await req(admin.cookie, 'PUT', `/api/users/${agent.user.id}/inboxes`, {
      inboxIds: [1, 3],
    });
    expect(put.statusCode).toBe(200);
    expect(UserSchema.parse(put.json()).inboxIds).toEqual([1, 3]);
    const list = InboxListResponse.parse((await req(admin.cookie, 'GET', '/api/inboxes')).json());
    expect(list.inboxes.map((i) => [i.id, i.memberIds])).toEqual([
      [1, [agent.user.id]],
      [2, []],
      [3, [agent.user.id]],
    ]);
    expect(list.canAdd).toBe(false);
    const users = (await req(admin.cookie, 'GET', '/api/users')).json() as { users: User[] };
    const byId = new Map(users.users.map((u) => [u.id, u]));
    expect(byId.get(agent.user.id)!.inboxIds).toEqual([1, 3]);
    expect(byId.get(admin.user.id)!.inboxIds).toBeUndefined();
    expect(auditRows(t, 'inbox.access_update').at(-1)).toEqual({
      userId: admin.user.id,
      meta: { targetId: agent.user.id, inboxIds: [1, 3] },
    });

    // PATCH memberIds replaces one inbox's members
    const members = await req(admin.cookie, 'PATCH', '/api/inboxes/2', {
      memberIds: [agent.user.id],
    });
    expect(members.json().memberIds).toEqual([agent.user.id]);
    expect(t.ctx.inboxes.repo.userInboxIds(agent.user.id)).toEqual([1, 2, 3]);
    expect(auditRows(t, 'inbox.create')[0]).toEqual({
      userId: admin.user.id,
      meta: { inboxId: 2, memberCount: 1, type: 'linked_phone' },
    });
  });

  it('validates bodies, ids and members', async () => {
    const { admin, agent, req } = await app({ maxInboxes: 3, inboxes: 2 });
    expect((await req(admin.cookie, 'POST', '/api/inboxes', { name: ' ' })).statusCode).toBe(400);
    expect((await req(admin.cookie, 'PATCH', '/api/inboxes/2', {})).statusCode).toBe(400);
    expect((await req(admin.cookie, 'PATCH', '/api/inboxes/9', { name: 'x' })).statusCode).toBe(
      404,
    );
    expect(
      (await req(admin.cookie, 'PATCH', '/api/inboxes/2', { memberIds: [999] })).statusCode,
    ).toBe(400);
    expect(
      (await req(admin.cookie, 'PUT', `/api/users/${agent.user.id}/inboxes`, { inboxIds: [7] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await req(admin.cookie, 'PUT', `/api/users/999/inboxes`, { inboxIds: [1] })).statusCode,
    ).toBe(404);
    expect((await req(admin.cookie, 'DELETE', '/api/inboxes/9')).statusCode).toBe(404);
  });

  it('agents never see memberIds, the QR or another inbox; admin routes are admin-only', async () => {
    const { t, agent, req } = await app({ maxInboxes: 3, inboxes: 3 });
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [2]);
    t.inboxWa(2).simulateStatus({ state: 'qr', qr: 'secret-qr' });
    const res = await req(agent.cookie, 'GET', '/api/inboxes');
    const list = InboxListResponse.parse(res.json());
    expect(list.inboxes.map((i) => i.id)).toEqual([2]);
    expect(list.inboxes[0]!.memberIds).toBeUndefined();
    expect(list.inboxes[0]!.status.qr).toBeNull();
    expect(list.canAdd).toBe(false);
    expect(res.body).not.toContain('secret-qr');
    for (const [method, url] of [
      ['POST', '/api/inboxes'],
      ['PATCH', '/api/inboxes/2'],
      ['DELETE', '/api/inboxes/2'],
      ['POST', '/api/inboxes/2/wa/logout'],
      ['PUT', `/api/users/${agent.user.id}/inboxes`],
    ] as const)
      expect((await req(agent.cookie, method, url, { name: 'x', inboxIds: [] })).statusCode).toBe(
        403,
      );
  });

  it('the directory and the users list carry inboxIds', async () => {
    const { t, admin, agent, req } = await app({ maxInboxes: 3, inboxes: 2 });
    const none = await createUserAndLogin(t);
    const aiUser = t.ctx.services.auth!.createUser({
      username: 'sales-ai',
      displayName: 'Sales Agent',
      role: 'agent',
      password: 'password123',
      mustChangePassword: false,
    });
    t.ctx.db.prepare("UPDATE users SET kind = 'ai' WHERE id = ?").run(aiUser.id);
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [2]);
    t.ctx.inboxes.repo.setUserInboxes(none.user.id, []);
    const dir = (await req(agent.cookie, 'GET', '/api/users/directory')).json() as {
      users: unknown[];
    };
    const rows = dir.users.map((u) => DirectoryUserSchema.parse(u));
    const byId = new Map(rows.map((u) => [u.id, u]));
    expect(byId.get(admin.user.id)!.inboxIds).toBe('all');
    expect(byId.get(agent.user.id)!.inboxIds).toEqual([2]);
    expect(byId.get(none.user.id)!.inboxIds).toEqual([]);
    const ai = rows.find((u) => u.kind === 'ai');
    expect(ai?.inboxIds).toBe('all');
    const users = (await req(admin.cookie, 'GET', '/api/users')).json() as { users: User[] };
    expect(users.users.find((u) => u.id === none.user.id)!.inboxIds).toEqual([]);
  });

  it('the directory shows an agent only the inboxes that agent may open', async () => {
    const { t, agent, req } = await app({ maxInboxes: 3, inboxes: 3 });
    const both = await createUserAndLogin(t);
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [1]);
    t.ctx.inboxes.repo.setUserInboxes(both.user.id, [1, 2, 3]);
    const dir = (await req(agent.cookie, 'GET', '/api/users/directory')).json() as {
      users: Array<{ id: number; inboxIds: 'all' | number[] }>;
    };
    expect(dir.users.find((u) => u.id === both.user.id)!.inboxIds).toEqual([1]);
    // an admin viewer sees every inbox of every user
    const admin2 = await createUserAndLogin(t, { role: 'admin' });
    const forAdmin = (await req(admin2.cookie, 'GET', '/api/users/directory')).json() as {
      users: Array<{ id: number; inboxIds: 'all' | number[] }>;
    };
    expect(forAdmin.users.find((u) => u.id === both.user.id)!.inboxIds).toEqual([1, 2, 3]);
  });

  it('demoting an admin unassigns their open chats in inboxes they no longer open', async () => {
    const { t, admin } = await app({ maxInboxes: 3, inboxes: 2 });
    const admin2 = await createUserAndLogin(t, { role: 'admin' });
    t.ctx.inboxes.repo.setUserInboxes(admin2.user.id, [1]);
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'one' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    const chats = getChats(t.ctx);
    chats.patch(C, { assignedTo: admin2.user.id }, admin.user.id);
    chats.patch(`${C}#2`, { assignedTo: admin2.user.id }, admin.user.id);
    t.ctx.services.auth!.updateUser(admin2.user.id, { role: 'agent' }, admin.user.id);
    expect(chats.get(C)!.assignedTo).toBe(admin2.user.id);
    expect(chats.get(`${C}#2`)!.assignedTo).toBeNull();
    // promoting back unassigns nothing
    chats.patch(C, { assignedTo: admin2.user.id }, admin.user.id);
    t.ctx.services.auth!.updateUser(admin2.user.id, { role: 'admin' }, admin.user.id);
    expect(chats.get(C)!.assignedTo).toBe(admin2.user.id);
  });

  it('removing an inbox unassigns the agents’ open chats in it; admins keep theirs', async () => {
    const { t, admin, agent, req } = await app({ maxInboxes: 3, inboxes: 2 });
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [1, 2]);
    const G2 = '120363000000000002@g.us';
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    t.inboxWa(2).simulateIncoming({
      chatJid: G2,
      body: 'group two',
      senderJid: '60175550001@s.whatsapp.net',
    });
    await settle();
    const chats = getChats(t.ctx);
    chats.patch(`${C}#2`, { assignedTo: agent.user.id }, admin.user.id);
    chats.patch(`${G2}#2`, { assignedTo: admin.user.id }, admin.user.id);
    expect((await req(admin.cookie, 'DELETE', '/api/inboxes/2')).statusCode).toBe(204);
    expect(chats.get(`${C}#2`)!.assignedTo).toBeNull();
    expect(chats.get(`${G2}#2`)!.assignedTo).toBe(admin.user.id);
  });

  it('a new agent starts with no inbox when two inboxes are active', async () => {
    const { t, admin, req } = await app({ maxInboxes: 3, inboxes: 2 });
    const created = await req(admin.cookie, 'POST', '/api/users', {
      username: 'newagent',
      displayName: 'New',
      role: 'agent',
      password: 'password123',
    });
    expect(created.statusCode).toBe(201);
    expect(t.ctx.inboxes.repo.userInboxIds((created.json() as User).id)).toEqual([]);
  });

  it('losing an inbox unassigns that agent’s open chats in it', async () => {
    const { t, admin, agent, req } = await app({ maxInboxes: 3, inboxes: 2 });
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [1, 2]);
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'one' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    await settle();
    const chats = getChats(t.ctx);
    chats.patch(C, { assignedTo: agent.user.id }, admin.user.id);
    chats.patch(`${C}#2`, { assignedTo: agent.user.id }, admin.user.id);
    const res = await req(admin.cookie, 'PUT', `/api/users/${agent.user.id}/inboxes`, {
      inboxIds: [1],
    });
    expect(res.statusCode).toBe(200);
    expect(chats.get(C)!.assignedTo).toBe(agent.user.id);
    expect(chats.get(`${C}#2`)!.assignedTo).toBeNull();
    // the same through PATCH /inboxes/:id members
    chats.patch(`${C}#2`, { assignedTo: admin.user.id }, admin.user.id);
    await req(admin.cookie, 'PATCH', '/api/inboxes/1', { memberIds: [] });
    expect(chats.get(C)!.assignedTo).toBeNull();
    expect(chats.get(`${C}#2`)!.assignedTo).toBe(admin.user.id);
  });

  it('removes inbox 2: phone unlinked, own folder gone, wa-auth/ untouched, chats read only (RF-5)', async () => {
    const { t, admin, agent, req } = await app({ maxInboxes: 3, inboxes: 2 });
    const dataDir = t.ctx.config.dataDir;
    mkdirSync(join(dataDir, 'wa-auth'), { recursive: true });
    writeFileSync(join(dataDir, 'wa-auth', 'creds.json'), '{}');
    mkdirSync(join(dataDir, 'wa-auth-inboxes', '2'), { recursive: true });
    writeFileSync(join(dataDir, 'wa-auth-inboxes', '2', 'creds.json'), '{}');
    t.ctx.inboxes.repo.setUserInboxes(agent.user.id, [1, 2]);
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'two' });
    t.inboxWa(2).simulateIncoming({
      chatJid: G,
      body: 'group two',
      senderJid: '60175550001@s.whatsapp.net',
    });
    await settle();
    const wa2 = t.inboxWa(2);
    const logout = vi.spyOn(wa2, 'logout');
    const primaryLogout = vi.spyOn(t.wa, 'logout');

    expect((await req(admin.cookie, 'DELETE', '/api/inboxes/1')).json().error.code).toBe(
      'primary_inbox',
    );
    const res = await req(admin.cookie, 'DELETE', '/api/inboxes/2');
    expect(res.statusCode).toBe(204);
    expect(logout).toHaveBeenCalledOnce();
    expect(primaryLogout).not.toHaveBeenCalled();
    expect(existsSync(join(dataDir, 'wa-auth', 'creds.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'wa-auth-inboxes', '2'))).toBe(false);
    expect(t.ctx.inboxes.repo.get(2)!.removed_at).not.toBeNull();
    expect(auditRows(t, 'inbox.remove')).toEqual([{ userId: admin.user.id, meta: { inboxId: 2 } }]);
    // a second delete finds nothing to remove
    expect((await req(admin.cookie, 'DELETE', '/api/inboxes/2')).statusCode).toBe(404);
    expect((await req(admin.cookie, 'PATCH', '/api/inboxes/2', { name: 'x' })).statusCode).toBe(
      409,
    );

    // admins still read the chat; agents lose it; nobody sends into it
    const key = enc(`${C}#2`);
    expect((await req(admin.cookie, 'GET', `/api/chats/${key}`)).statusCode).toBe(200);
    // no phone looks pictures up for a removed inbox
    expect((await req(admin.cookie, 'GET', `/api/chats/${key}/avatar`)).statusCode).toBe(204);
    const member = enc('60175550001@s.whatsapp.net');
    expect(
      (await req(admin.cookie, 'GET', `/api/chats/${enc(`${G}#2`)}/members/${member}/avatar`))
        .statusCode,
    ).toBe(204);
    expect((await req(agent.cookie, 'GET', `/api/chats/${key}`)).statusCode).toBe(404);
    const send = await req(admin.cookie, 'POST', `/api/chats/${key}/messages`, {
      text: 'hello',
      clientId: 'c-removed',
    });
    expect(send.statusCode).toBe(409);
    expect(send.json().error.code).toBe('inbox_removed');
    const forAdmin = InboxListResponse.parse(
      (await req(admin.cookie, 'GET', '/api/inboxes')).json(),
    );
    expect(forAdmin.inboxes.find((i) => i.id === 2)).toMatchObject({
      removed: true,
      status: { state: 'logged_out' },
    });
    const forAgent = InboxListResponse.parse(
      (await req(agent.cookie, 'GET', '/api/inboxes')).json(),
    );
    expect(forAgent.inboxes.map((i) => i.id)).toEqual([1]);
    expect((await req(admin.cookie, 'POST', '/api/inboxes/2/wa/relink')).statusCode).toBe(404);
  });

  it('per-inbox WhatsApp actions act on that inbox and audit its id', async () => {
    const { t, admin, req } = await app({ maxInboxes: 3, inboxes: 2 });
    const wa2 = t.inboxWa(2);
    const spies = {
      logout: vi.spyOn(wa2, 'logout'),
      connect: vi.spyOn(wa2, 'connect'),
      takeover: vi.spyOn(wa2, 'takeover'),
      pairing: vi.spyOn(wa2, 'requestPairingCode'),
    };
    const primary = vi.spyOn(t.wa, 'logout');
    const out = await req(admin.cookie, 'POST', '/api/inboxes/2/wa/logout');
    expect(out.statusCode).toBe(200);
    expect(out.json()).toMatchObject({ state: 'logged_out' });
    // a phone links by code only while the inbox is unlinked
    const code = await req(admin.cookie, 'POST', '/api/inboxes/2/wa/pairing-code', {
      phone: '60123456789',
    });
    expect(code.statusCode).toBe(200);
    expect(code.json()).toEqual({ code: 'FAKE1234' });
    expect(spies.pairing).toHaveBeenCalledWith('60123456789');
    for (const action of ['relink', 'takeover']) {
      const res = await req(admin.cookie, 'POST', `/api/inboxes/2/wa/${action}`);
      expect(res.statusCode, action).toBe(200);
    }
    expect(spies.logout).toHaveBeenCalledTimes(2);
    expect(spies.connect).toHaveBeenCalled();
    expect(spies.takeover).toHaveBeenCalledOnce();
    expect(primary).not.toHaveBeenCalled();
    const linked = await req(admin.cookie, 'POST', '/api/inboxes/2/wa/pairing-code', {
      phone: '60123456789',
    });
    expect(linked.statusCode).toBe(400);
    for (const action of ['wa.logout', 'wa.relink', 'wa.takeover', 'wa.pairing_code'])
      expect(auditRows(t, action).at(-1)!.meta).toMatchObject({ inboxId: 2 });
    // /wa/* stays inbox 1 and says so
    await req(admin.cookie, 'POST', '/api/wa/takeover');
    expect(auditRows(t, 'wa.takeover').at(-1)!.meta).toMatchObject({ inboxId: 1 });
    expect((await req(admin.cookie, 'POST', '/api/inboxes/9/wa/logout')).statusCode).toBe(404);
    // relink still links when the old session is already gone
    spies.logout.mockRejectedValueOnce(new Error('socket closed'));
    expect((await req(admin.cookie, 'POST', '/api/inboxes/2/wa/relink')).statusCode).toBe(200);
  });

  it('an active inbox without a connection (over the limit) shows offline and has no actions', async () => {
    const { t, admin, req } = await app({ maxInboxes: 2, inboxes: 2 });
    // a row a bigger build left behind: no adapter in this build
    const row = t.ctx.inboxes.repo.insert('Extra', 'info', Date.now());
    const list = InboxListResponse.parse((await req(admin.cookie, 'GET', '/api/inboxes')).json());
    expect(list.inboxes.find((i) => i.id === row.id)).toMatchObject({
      removed: false,
      status: { state: 'logged_out', qr: null },
    });
    expect((await req(admin.cookie, 'POST', `/api/inboxes/${row.id}/wa/logout`)).statusCode).toBe(
      404,
    );
  });

  it('a new inbox whose connection fails is not left active', async () => {
    const { t, admin, req } = await app({ maxInboxes: 3 });
    vi.spyOn(t.ctx.inboxes.connections, 'add').mockRejectedValueOnce(new Error('no adapter'));
    const res = await req(admin.cookie, 'POST', '/api/inboxes', { name: 'Broken' });
    expect(res.statusCode).toBe(500);
    expect(t.ctx.inboxes.repo.get(2)!.removed_at).not.toBeNull();
    expect(t.ctx.inboxes.repo.active().map((r) => r.id)).toEqual([1]);
  });

  it('the AI member opens every inbox: its access is not set', async () => {
    const { t, admin, req } = await app({ maxInboxes: 3, inboxes: 2 });
    const ai = t.ctx.services.auth!.createUser({
      username: 'sales-ai',
      displayName: 'Sales Agent',
      role: 'agent',
      password: 'password123',
      mustChangePassword: false,
    });
    t.ctx.db.prepare("UPDATE users SET kind = 'ai' WHERE id = ?").run(ai.id);
    const res = await req(admin.cookie, 'PUT', `/api/users/${ai.id}/inboxes`, { inboxIds: [1] });
    expect(res.statusCode).toBe(400);
    expect(t.ctx.inboxes.repo.userInboxIds(ai.id)).toEqual([]);
    // nor can the AI member be listed as an inbox member
    expect(
      (await req(admin.cookie, 'PATCH', '/api/inboxes/2', { memberIds: [ai.id] })).statusCode,
    ).toBe(400);
  });
});

// resolve_chat / reopen_chat through the real /mcp route: real tokens (with and without scope
// inbox:manage), the real chat service, fake WhatsApp. Design: docs/features/mcp-resolve-chat/design.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@ezychat/shared';
import { setMcpEnabled } from '../src/mcp/settings.js';
import { askEzyTools } from '../src/ask-ezy/tools.js';
import { authHeaders } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { data, mcpClient, rpc, waitFor } from './mcp-helpers.js';

const A = '60111111111@s.whatsapp.net';
const B = '60122222222@s.whatsapp.net';
const C = '60133333333@s.whatsapp.net';
const HIDDEN = '60144444444@s.whatsapp.net';

let t: TestApp;
let owner: User;
let cookie: string;
let readOnly: string;
let manager: string;
let managerId: number;

const mcp = mcpClient(() => t);
const call = (name: string, args: Record<string, unknown>, token = manager) =>
  mcp.call(name, args, token);
let n = 0;
const requestId = () => `req-manage-${++n}-abc`;

const chatRow = (jid: string) =>
  t.ctx.db.prepare('SELECT status, assigned_to FROM chats WHERE jid = ?').get(jid) as {
    status: string;
    assigned_to: number | null;
  };
const eventTypes = (jid: string) =>
  (
    t.ctx.db
      .prepare('SELECT type, actor_id, payload FROM chat_events WHERE chat_jid = ? ORDER BY id')
      .all(jid) as Array<{ type: string; actor_id: number | null; payload: string }>
  ).map((e) => ({ type: e.type, actor: e.actor_id, payload: JSON.parse(e.payload) }));
const patchChat = (jid: string, body: Record<string, unknown>) =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/chats/${encodeURIComponent(jid)}`,
    headers: authHeaders(cookie),
    payload: body,
  });
const audits = (action: string) =>
  (
    t.ctx.db
      .prepare('SELECT user_id, meta FROM audit_log WHERE action = ? ORDER BY id')
      .all(action) as Array<{ user_id: number; meta: string }>
  ).map((r) => ({ userId: r.user_id, meta: JSON.parse(r.meta) }));

beforeAll(async () => {
  t = await makeTestApp({ listen: true });
  const auth = t.ctx.services.auth!;
  owner = auth.createUser({
    username: 'owner',
    displayName: 'Owner',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  cookie = `sid=${auth.createSession(owner.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  const tokens = t.ctx.services.apiTokens!;
  readOnly = tokens.create(owner.id, { name: 'reader', expiresInDays: 90 }, 'ip').secret;
  const created = tokens.create(
    owner.id,
    { name: 'triage', expiresInDays: 90, canResolveChats: true },
    'ip',
  );
  manager = created.secret;
  managerId = created.token.id;
  setMcpEnabled(t.ctx, true);
  for (const [jid, body] of [
    [A, 'Thanks, all good!'],
    [B, 'Thank you!'],
    [C, 'Where is my order?'],
    [HIDDEN, 'Hello'],
  ] as const)
    t.wa.simulateIncoming({ chatJid: jid, body, senderName: 'Customer' });
  await waitFor(() => mcp.count('SELECT COUNT(*) AS n FROM chats') === 4);
  t.ctx.db
    .prepare("UPDATE chats SET hidden_at = 1, hidden_number = '60000000000' WHERE jid = ?")
    .run(HIDDEN);
});
afterAll(async () => {
  await t.close();
});

describe('who can resolve', () => {
  it('lists resolve_chat and reopen_chat only for a token with "Can resolve chats"', async () => {
    const tools = async (token: string) =>
      (await mcp.post(rpc('tools/list'), token)).json().result.tools as Array<{
        name: string;
        annotations: Record<string, boolean>;
        description: string;
      }>;
    const names = (await tools(readOnly)).map((x) => x.name);
    expect(names).not.toContain('resolve_chat');
    expect(names).not.toContain('reopen_chat');
    const list = await tools(manager);
    const resolve = list.find((x) => x.name === 'resolve_chat')!;
    expect(list.map((x) => x.name)).toContain('reopen_chat');
    // A change (clients may ask first), but it reaches nobody outside the app.
    expect(resolve.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
    // The model is told when (not) to resolve and that the customer is not messaged.
    expect(resolve.description).toMatch(/customer is NOT messaged/);
    expect(resolve.description).toMatch(/Never resolve to hide a complaint/);
    // A manage-only token cannot send.
    expect(list.map((x) => x.name)).not.toContain('send_message');
  });

  it('a read-only token cannot call it and nothing changes', async () => {
    const r = await call('resolve_chat', { chatId: C, requestId: requestId() }, readOnly);
    expect(r.isError).toBe(true);
    expect(chatRow(C).status).toBe('open');
  });

  it('Ask Ezy never gets the chat tools', () => {
    const tools = askEzyTools({
      user: owner,
      // only the tool list is read here
      inbox: {} as never,
      aiSetup: {} as never,
      onCall: () => undefined,
    } as never);
    expect(Object.keys(tools)).not.toContain('resolve_chat');
    expect(Object.keys(tools)).not.toContain('reopen_chat');
  });
});

describe('resolving', () => {
  it('does exactly what a teammate’s Resolve does in the app; WhatsApp gets nothing', async () => {
    // Both chats assigned to the owner, then one resolved in the app, the other through MCP.
    expect((await patchChat(A, { assignedTo: owner.id })).statusCode).toBe(200);
    expect((await patchChat(B, { assignedTo: owner.id })).statusCode).toBe(200);
    const updates: string[] = [];
    const onUpdate = (c: { jid: string; status: string }) => updates.push(`${c.jid}:${c.status}`);
    t.ctx.bus.on('chat:updated', onUpdate);
    const sentBefore = t.wa.sent.length;

    expect((await patchChat(A, { status: 'resolved' })).statusCode).toBe(200);
    const r = await call('resolve_chat', { chatId: B, requestId: requestId() });
    t.ctx.bus.off('chat:updated', onUpdate);

    expect(r.isError).toBeUndefined();
    expect(data(r)).toEqual({ chatId: B, status: 'resolved', changed: true, duplicate: false });
    expect(chatRow(B)).toEqual(chatRow(A));
    expect(chatRow(B)).toEqual({ status: 'resolved', assigned_to: null });
    expect(eventTypes(B)).toEqual(eventTypes(A));
    expect(eventTypes(B).slice(-2)).toEqual([
      { type: 'resolved', actor: owner.id, payload: {} },
      { type: 'unassigned', actor: owner.id, payload: { previous: owner.id, reason: 'resolved' } },
    ]);
    // the same live update the inbox receives
    expect(updates).toEqual([`${A}:resolved`, `${B}:resolved`]);
    expect(t.wa.sent.length).toBe(sentBefore);
    // the open list and the stats count it like the app's resolve
    const stats = data(await call('get_stats', { days: 1 }));
    expect(stats.chats).toMatchObject({ resolved: 2 });
  });

  it('audits the change with token and chat only, never the note', async () => {
    const note = 'Customer confirmed delivery, secret detail 42';
    const r = data(await call('resolve_chat', { chatId: C, requestId: requestId(), note }));
    expect(r).toMatchObject({ chatId: C, status: 'resolved', changed: true, noteAdded: true });
    const rows = audits('mcp.resolve');
    expect(rows.at(-1)).toEqual({
      userId: owner.id,
      meta: { tokenId: managerId, chatJid: C },
    });
    expect(JSON.stringify(audits('mcp.resolve'))).not.toContain('secret detail');
    // the note is a team note in the chat, written as the owner
    const notes = t.ctx.db
      .prepare('SELECT user_id, body FROM notes WHERE chat_jid = ?')
      .all(C) as Array<{ user_id: number; body: string }>;
    expect(notes).toEqual([{ user_id: owner.id, body: note }]);
  });

  it('an already resolved chat is not changed and not audited again', async () => {
    const before = audits('mcp.resolve').length;
    const r = data(await call('resolve_chat', { chatId: A, requestId: requestId() }));
    expect(r).toEqual({ chatId: A, status: 'resolved', changed: false, duplicate: false });
    expect(audits('mcp.resolve').length).toBe(before);
  });

  it('reopen_chat undoes it like Reopen in the app, and is audited', async () => {
    const r = data(await call('reopen_chat', { chatId: C, requestId: requestId() }));
    expect(r).toEqual({ chatId: C, status: 'open', changed: true, duplicate: false });
    expect(chatRow(C).status).toBe('open');
    expect(eventTypes(C).at(-1)).toMatchObject({ type: 'reopened', actor: owner.id });
    expect(audits('mcp.reopen').at(-1)).toEqual({
      userId: owner.id,
      meta: { tokenId: managerId, chatJid: C },
    });
  });
});

describe('retries and refusals', () => {
  it('a repeated requestId changes nothing again; reusing it for another change is refused', async () => {
    const id = requestId();
    const first = data(await call('resolve_chat', { chatId: C, requestId: id }));
    expect(first).toMatchObject({ changed: true, duplicate: false });
    // someone reopens it meanwhile: the retry must not resolve it again
    expect((await patchChat(C, { status: 'open' })).statusCode).toBe(200);
    const again = data(await call('resolve_chat', { chatId: C, requestId: id }));
    expect(again).toEqual({ ...first, duplicate: true });
    expect(chatRow(C).status).toBe('open');

    const other = await call('reopen_chat', { chatId: C, requestId: id });
    expect(other.isError).toBe(true);
    expect(other.content[0]!.text).toMatch(/already used for a different change/);
    const elsewhere = await call('resolve_chat', { chatId: A, requestId: id });
    expect(elsewhere.isError).toBe(true);
  });

  it('a chat hidden on Log out, or one that does not exist, is "not found"', async () => {
    for (const chatId of [HIDDEN, '60999999999@s.whatsapp.net', '60999999999']) {
      const r = await call('resolve_chat', { chatId, requestId: requestId() });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toBe(`No chat found for ${chatId}.`);
    }
    expect(chatRow(HIDDEN).status).toBe('open');
  });

  it('rejects malformed input before anything runs', async () => {
    const r = await call('resolve_chat', { chatId: C, requestId: 'short' });
    expect(r.isError).toBe(true);
    expect((await call('reopen_chat', { chatId: '', requestId: requestId() })).isError).toBe(true);
    const long = 'x'.repeat(2001);
    expect(
      (await call('resolve_chat', { chatId: C, requestId: requestId(), note: long })).isError,
    ).toBe(true);
    expect(chatRow(C).status).toBe('open');
  });

  it('stops working at once when its owner is no longer an admin', async () => {
    const auth = t.ctx.services.auth!;
    const second = auth.createUser({
      username: 'second',
      displayName: 'Second',
      role: 'admin',
      password: 'password123',
      mustChangePassword: false,
    });
    const token = t.ctx.services.apiTokens!.create(
      second.id,
      { name: 'theirs', expiresInDays: 90, canResolveChats: true },
      'ip',
    ).secret;
    expect(chatRow(C).status).toBe('open');
    auth.updateUser(second.id, { role: 'agent' }, owner.id);
    const res = await mcp.post(
      rpc('tools/call', {
        name: 'resolve_chat',
        arguments: { chatId: C, requestId: requestId() },
      }),
      token,
    );
    expect(res.statusCode).toBe(401);
    expect(chatRow(C).status).toBe('open');
  });
});

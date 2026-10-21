// MCP tools with several inboxes (WhatsApp numbers): the token owner's inbox scope, inbox fields in
// results, per-inbox stats, replies from the chat's own number and the inbox choice of
// send_to_new_number. Lite (one inbox) keeps its schemas and results. Plan: multi-inbox Task 5.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '@ezychat/shared';
import type { ApiPrincipal } from '../src/api-tokens/index.js';
import { audit } from '../src/db/audit.js';
import { createInboxReadPort } from '../src/mcp/inbox.js';
import { createInboxSendPort } from '../src/mcp/send.js';
import { setMcpEnabled } from '../src/mcp/settings.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { data, mcpClient, rpc, waitFor } from './mcp-helpers.js';

const C = '60123456789@s.whatsapp.net';
const C2 = `${C}#2`;

function admin(t: TestApp): User {
  return t.ctx.services.auth!.createUser({
    username: 'owner',
    displayName: 'Owner',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
}

function token(t: TestApp, userId: number): string {
  return t.ctx.services.apiTokens!.create(
    userId,
    { name: 'all', expiresInDays: 90, canSend: true, canMessageNewNumbers: true },
    'ip',
  ).secret;
}

const chatCount = (t: TestApp, jid: string) =>
  (t.ctx.db.prepare('SELECT COUNT(*) AS n FROM chats WHERE jid = ?').get(jid) as { n: number }).n;

let n = 0;
const requestId = () => `req-multi-${++n}-abcdef`;

type ToolInfo = {
  name: string;
  inputSchema: { properties: Record<string, unknown>; required?: string[] };
};

describe('several inboxes', () => {
  let t: TestApp;
  let owner: User;
  let secret: string;
  const mcp = mcpClient(() => t);
  const call = (name: string, args: Record<string, unknown>) => mcp.call(name, args, secret);

  beforeAll(async () => {
    t = await makeTestApp({ listen: true, maxInboxes: 3, inboxes: 2 });
    owner = admin(t);
    secret = token(t, owner.id);
    setMcpEnabled(t.ctx, true);
    t.ctx.inboxes.repo.rename(2, 'Sales');
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'Hi one', senderName: 'Aminah' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'Hi two', senderName: 'Aminah' });
    t.inboxWa(2).simulateIncoming({
      chatJid: '60199999999@s.whatsapp.net',
      body: 'Another',
      senderName: 'Ben',
    });
    await waitFor(
      () =>
        chatCount(t, C) === 1 &&
        chatCount(t, C2) === 1 &&
        chatCount(t, '60199999999@s.whatsapp.net#2') === 1,
    );
  });
  afterAll(async () => {
    await t.close();
  });

  it('lists inboxId as an optional input of the inbox and new-number tools', async () => {
    const tools = (await mcp.post(rpc('tools/list'), secret)).json().result.tools as ToolInfo[];
    for (const name of ['list_chats', 'get_stats', 'get_activity', 'send_to_new_number']) {
      const tool = tools.find((x) => x.name === name)!;
      expect(tool.inputSchema.properties).toHaveProperty('inboxId');
      expect(tool.inputSchema.required ?? []).not.toContain('inboxId');
    }
  });

  it('list_chats shows every inbox with its id and name, and filters by inboxId', async () => {
    const all = data(await call('list_chats', {}));
    expect(
      all.chats.map((c: { jid: string; inboxId: number; inboxName: string }) => [
        c.jid,
        c.inboxId,
        c.inboxName,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [C, 1, 'WhatsApp'],
        [C2, 2, 'Sales'],
        ['60199999999@s.whatsapp.net#2', 2, 'Sales'],
      ]),
    );
    const two = data(await call('list_chats', { inboxId: 2 }));
    expect(two.chats.map((c: { inboxId: number }) => c.inboxId)).toEqual([2, 2]);
    const unknown = await call('list_chats', { inboxId: 9 });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]!.text).toMatch(/No inbox 9/);
  });

  it('get_chat and get_messages read the inbox 2 chat by its key', async () => {
    const chat = data(await call('get_chat', { jid: C2 }));
    expect(chat.chat).toMatchObject({ jid: C2, inboxId: 2, inboxName: 'Sales' });
    const msgs = data(await call('get_messages', { jid: C2 }));
    expect(msgs.messages.map((m: { text: string }) => m.text)).toEqual(['Hi two']);
  });

  it('get_stats adds one byInbox row per active inbox; inboxId narrows to that inbox', async () => {
    const all = data(await call('get_stats', { days: 1 }));
    expect(all.chats.open).toBe(3);
    expect(all.byInbox).toEqual([
      expect.objectContaining({ inboxId: 1, name: 'WhatsApp', open: 1, waitingForReply: 1 }),
      expect.objectContaining({ inboxId: 2, name: 'Sales', open: 2, waitingForReply: 2 }),
    ]);
    expect(all.byInbox[1]).toMatchObject({ inbound: 2, outbound: 0, resolved: 0 });
    const two = data(await call('get_stats', { days: 1, inboxId: 2 }));
    expect(two.chats.open).toBe(2);
    expect(two).not.toHaveProperty('byInbox');
    expect((await call('get_stats', { inboxId: 9 })).isError).toBe(true);
  });

  it('get_activity adds one byInbox row per active inbox; inboxId narrows to that inbox', async () => {
    const all = data(await call('get_activity', { days: 1 }));
    expect(all.byInbox).toEqual([
      expect.objectContaining({ inboxId: 1, name: 'WhatsApp', customerMessages: 1 }),
      expect.objectContaining({ inboxId: 2, name: 'Sales', customerMessages: 2 }),
    ]);
    expect(all.byInbox[0].firstReply).toMatchObject({ answered: 0, unanswered: 1 });
    const two = data(await call('get_activity', { days: 1, inboxId: 2 }));
    expect(two).not.toHaveProperty('byInbox');
    const total = two.byHour.reduce(
      (sum: number, h: { customerMessages: number }) => sum + h.customerMessages,
      0,
    );
    expect(total).toBe(2);
    expect((await call('get_activity', { inboxId: 9 })).isError).toBe(true);
  });

  it('send_message replies from the chat own number; queued follows that inbox', async () => {
    const before1 = t.inboxWa(1).sent.length;
    const r = data(
      await call('send_message', { jid: C2, text: 'From two', requestId: requestId() }),
    );
    expect(r).toMatchObject({ chatJid: C2, queued: false, duplicate: false });
    await waitFor(() => t.inboxWa(2).sent.some((s) => s.text === 'From two'));
    expect(t.inboxWa(1).sent.length).toBe(before1);

    t.inboxWa(2).setConnected(false);
    try {
      const q = data(
        await call('send_message', { jid: C2, text: 'Later', requestId: requestId() }),
      );
      expect(q.queued).toBe(true);
      const one = data(await call('send_message', { jid: C, text: 'Now', requestId: requestId() }));
      expect(one.queued).toBe(false);
    } finally {
      t.inboxWa(2).setConnected(true);
    }
  });

  it('a phone or bare JID with chats in two inboxes asks for the chat id; nothing is sent', async () => {
    const sent = () => t.inboxWa(1).sent.length + t.inboxWa(2).sent.length;
    const before = sent();
    for (const jid of ['60123456789', '+60 12-345 6789']) {
      const r = await call('send_message', { jid, text: 'Which one?', requestId: requestId() });
      expect(r.isError).toBe(true);
      const text = r.content[0]!.text as string;
      expect(text).toMatch(/inbox_required/);
      expect(text).toContain(`${C} (inbox 1, WhatsApp)`);
      expect(text).toContain(`${C2} (inbox 2, Sales)`);
    }
    expect(sent()).toBe(before);
    for (const tool of ['get_chat', 'get_messages']) {
      const r = await call(tool, { jid: '60123456789' });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/inbox_required/);
      expect(r.content[0]!.text).toContain(C2);
    }
    // the chat id from list_chats is exact: the inbox 1 key never becomes ambiguous
    expect(data(await call('get_chat', { jid: C })).chat).toMatchObject({ jid: C, inboxId: 1 });
  });

  it('a phone or bare JID with a chat in one inbox only finds that chat', async () => {
    const other = '60199999999@s.whatsapp.net';
    const chat = data(await call('get_chat', { jid: '60199999999' }));
    expect(chat.chat).toMatchObject({ jid: `${other}#2`, inboxId: 2 });
    const msgs = data(await call('get_messages', { jid: other }));
    expect(msgs.messages.map((m: { text: string }) => m.text)).toEqual(['Another']);
    const r = data(
      await call('send_message', { jid: other, text: 'Only two', requestId: requestId() }),
    );
    expect(r.chatJid).toBe(`${other}#2`);
    await waitFor(() => t.inboxWa(2).sent.some((s) => s.text === 'Only two'));
    expect(t.inboxWa(1).sent.some((s) => s.text === 'Only two')).toBe(false);
    expect((await call('get_chat', { jid: '60100000000' })).isError).toBe(true);
  });

  it('get_stats with inboxId counts the AI Sales Agent of that inbox only', async () => {
    for (const [chatJid, reason] of [
      [C, 'missing_facts'],
      [C2, 'sensitive'],
      [C2, 'sensitive'],
      ['not a key#x', 'sensitive'],
    ] as const)
      audit(t.ctx.db, {
        userId: null,
        action: 'ai.handoff',
        ip: null,
        meta: { chatJid, assignedTo: null, reason },
      });
    audit(t.ctx.db, { userId: null, action: 'ai.resolve', ip: null, meta: { chatJid: C } });
    const two = data(await call('get_stats', { days: 1, inboxId: 2 }));
    expect(two.ai.handoffsByReason).toEqual({ sensitive: 2 });
    expect(two.ai.totals).toMatchObject({ handoffs: 2, resolvedByAi: 0 });
    const one = data(await call('get_stats', { days: 1, inboxId: 1 }));
    expect(one.ai.totals).toMatchObject({ handoffs: 1, resolvedByAi: 1 });
    const all = data(await call('get_stats', { days: 1 }));
    expect(all.ai.totals).toMatchObject({ handoffs: 4, resolvedByAi: 1 });
  });

  it('send_to_new_number needs an inbox choice and lists the inboxes', async () => {
    const r = await call('send_to_new_number', {
      phone: '60111000001',
      text: 'Hello',
      requestId: requestId(),
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/inbox_required/);
    expect(r.content[0]!.text).toContain('1 (WhatsApp)');
    expect(r.content[0]!.text).toContain('2 (Sales)');
    expect(chatCount(t, '60111000001@s.whatsapp.net')).toBe(0);

    const bad = await call('send_to_new_number', {
      phone: '60111000001',
      text: 'Hello',
      requestId: requestId(),
      inboxId: 9,
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/No inbox 9/);
  });

  it('send_to_new_number with inboxId 2 checks through that number and opens the chat there', async () => {
    const check1 = vi.spyOn(t.inboxWa(1), 'checkNumber');
    const check2 = vi.spyOn(t.inboxWa(2), 'checkNumber');
    const r = data(
      await call('send_to_new_number', {
        phone: '60111000002',
        text: 'Hello from sales',
        requestId: requestId(),
        inboxId: 2,
      }),
    );
    expect(check2).toHaveBeenCalledWith('60111000002');
    expect(check1).not.toHaveBeenCalled();
    expect(r).toMatchObject({ chatJid: '60111000002@s.whatsapp.net#2', newChat: true });
    expect(chatCount(t, '60111000002@s.whatsapp.net')).toBe(0);
    await waitFor(() => t.inboxWa(2).sent.some((s) => s.text === 'Hello from sales'));
    expect(t.inboxWa(1).sent.some((s) => s.text === 'Hello from sales')).toBe(false);
  });

  it('refuses any inbox own number, also from another inbox', async () => {
    const phone = t.inboxWa(1).status.me!.jid.split(/[:@]/)[0]!;
    const r = await call('send_to_new_number', {
      phone,
      text: 'Hello me',
      requestId: requestId(),
      inboxId: 2,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/linked WhatsApp number/);
  });

  it('a removed inbox is no choice for new numbers; its chats answer inbox_removed', async () => {
    const id = await t.addInbox('Temp');
    t.inboxWa(id).simulateIncoming({ chatJid: C, body: 'Hi three', senderName: 'Aminah' });
    await waitFor(() => chatCount(t, `${C}#${id}`) === 1);
    t.ctx.inboxes.repo.markRemoved(id, Date.now());
    await t.ctx.inboxes.connections.remove(id);

    const choice = await call('send_to_new_number', {
      phone: '60111000003',
      text: 'Hello',
      requestId: requestId(),
      inboxId: id,
    });
    expect(choice.isError).toBe(true);
    expect(choice.content[0]!.text).toMatch(new RegExp(`No inbox ${id}`));
    const sent = await call('send_message', {
      jid: `${C}#${id}`,
      text: 'Hello',
      requestId: requestId(),
    });
    expect(sent.isError).toBe(true);
    expect(sent.content[0]!.text).toMatch(/inbox was removed/);
    // still readable for the admin, with its inbox name
    const chat = data(await call('get_chat', { jid: `${C}#${id}` }));
    expect(chat.chat).toMatchObject({ inboxId: id, inboxName: 'Temp' });
    // byInbox counts active inboxes only
    const stats = data(await call('get_stats', { days: 1 }));
    expect(stats.byInbox.map((r: { inboxId: number }) => r.inboxId)).toEqual([1, 2]);
  });

  it('an agent principal sees only the inboxes it was given (ports, defence in depth)', () => {
    const agent = t.ctx.services.auth!.createUser({
      username: 'agent1',
      displayName: 'Agent One',
      role: 'agent',
      password: 'password123',
      mustChangePassword: false,
    });
    t.ctx.inboxes.repo.setUserInboxes(agent.id, [1]);
    const read = createInboxReadPort(t.ctx);
    const list = read.listChats({ assigned: 'any', limit: 50 }, agent);
    expect(list.chats.map((c) => c.inboxId)).toEqual([1]);
    expect(() => read.listChats({ assigned: 'any', limit: 50 }, agent, 2)).toThrow(/No inbox 2/);
    expect(read.getChat(C2, agent)).toBeNull();
    // the inbox 2 chat of the same phone is outside the scope: the phone is not ambiguous
    expect(read.getChat('60123456789', agent)?.chat.jid).toBe(C);
    expect(read.listMessages(C2, { limit: 10 }, agent)).toBeNull();
    expect(read.stats(1, agent).chats.open).toBe(1);
    expect(read.stats(1, agent)).not.toHaveProperty('byInbox');
    expect(read.activity(1, agent)).not.toHaveProperty('byInbox');
    expect(read.inboxesFor(agent).map((i) => i.id)).toEqual([1]);

    const principal: ApiPrincipal = {
      tokenId: 99,
      user: agent,
      scopes: new Set(['inbox:send', 'inbox:send_new']) as ApiPrincipal['scopes'],
    };
    const send = createInboxSendPort(t.ctx);
    expect(() =>
      send.sendText(principal, { jid: C2, text: 'Nope', requestId: requestId() }),
    ).toThrow(/No chat found/);
  });
});

describe('one active inbox left after another was removed', () => {
  let t: TestApp;
  let secret: string;
  const mcp = mcpClient(() => t);
  const call = (name: string, args: Record<string, unknown>) => mcp.call(name, args, secret);

  beforeAll(async () => {
    t = await makeTestApp({ listen: true, maxInboxes: 2, inboxes: 2 });
    secret = token(t, admin(t).id);
    setMcpEnabled(t.ctx, true);
    t.ctx.inboxes.repo.rename(2, 'Old');
    t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'Hi one', senderName: 'Aminah' });
    t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'Hi two', senderName: 'Aminah' });
    await waitFor(() => chatCount(t, C) === 1 && chatCount(t, C2) === 1);
    t.ctx.inboxes.repo.markRemoved(2, Date.now());
    await t.ctx.inboxes.connections.remove(2);
  });
  afterAll(async () => {
    await t.close();
  });

  it('chats of the active inbox carry no inbox fields; a chat of the removed inbox names it', async () => {
    const list = data(await call('list_chats', {}));
    const one = list.chats.find((c: { jid: string }) => c.jid === C);
    expect(one).not.toHaveProperty('inboxId');
    expect(one).not.toHaveProperty('inboxName');
    const old = list.chats.find((c: { jid: string }) => c.jid === C2);
    expect(old).toMatchObject({ inboxId: 2, inboxName: 'Old' });
    expect(data(await call('get_chat', { jid: C })).chat).not.toHaveProperty('inboxId');
    expect(data(await call('get_chat', { jid: C2 })).chat).toMatchObject({ inboxId: 2 });
    // a phone resolves in the active inbox only, so it is not ambiguous
    expect(data(await call('get_chat', { jid: '60123456789' })).chat.jid).toBe(C);
    expect(data(await call('get_stats', { days: 1 }))).not.toHaveProperty('byInbox');
  });
});

describe('Lite (one inbox)', () => {
  let t: TestApp;
  let secret: string;
  const mcp = mcpClient(() => t);
  const call = (name: string, args: Record<string, unknown>) => mcp.call(name, args, secret);

  beforeAll(async () => {
    t = await makeTestApp({ listen: true });
    secret = token(t, admin(t).id);
    setMcpEnabled(t.ctx, true);
    t.wa.simulateIncoming({ chatJid: C, body: 'Hello', senderName: 'Aminah' });
    await waitFor(() => chatCount(t, C) === 1);
  });
  afterAll(async () => {
    await t.close();
  });

  it('keeps the required inputs of every tool', async () => {
    const tools = (await mcp.post(rpc('tools/list'), secret)).json().result.tools as ToolInfo[];
    const required = Object.fromEntries(
      tools
        .filter((x) =>
          [
            'list_chats',
            'get_stats',
            'get_activity',
            'send_message',
            'send_to_new_number',
          ].includes(x.name),
        )
        .map((x) => [x.name, [...(x.inputSchema.required ?? [])].sort()]),
    );
    expect(required).toEqual({
      list_chats: [],
      get_stats: [],
      get_activity: [],
      send_message: ['jid', 'requestId', 'text'],
      send_to_new_number: ['phone', 'requestId', 'text'],
    });
  });

  it('results carry no inbox fields', async () => {
    const list = data(await call('list_chats', {}));
    expect(Object.keys(list.chats[0]).sort()).toEqual(
      [
        'assignedTo',
        'jid',
        'lastMessageAt',
        'lastMessagePreview',
        'name',
        'phone',
        'status',
        'tags',
        'type',
        'unreadCount',
      ].sort(),
    );
    expect(data(await call('get_chat', { jid: C })).chat).not.toHaveProperty('inboxId');
    expect(data(await call('get_stats', {}))).not.toHaveProperty('byInbox');
    expect(data(await call('get_activity', {}))).not.toHaveProperty('byInbox');
  });

  it('send_to_new_number needs no inbox choice', async () => {
    const r = data(
      await call('send_to_new_number', {
        phone: '60111000009',
        text: 'Hello',
        requestId: requestId(),
      }),
    );
    expect(r).toMatchObject({ chatJid: '60111000009@s.whatsapp.net', newChat: true });
    const one = data(
      await call('send_to_new_number', {
        phone: '60111000008',
        text: 'Hello',
        requestId: requestId(),
        inboxId: 1,
      }),
    );
    expect(one.chatJid).toBe('60111000008@s.whatsapp.net');
  });
});

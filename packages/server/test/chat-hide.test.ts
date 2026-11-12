// Hide chats on Log out (docs/features/chat-hide-delete/design.md Part A): the admin's Log out and an
// unlink from the phone hide every chat of a linked phone's inbox; a connection drop and the Business API
// hide nothing; hidden chats are missing for every reader; the same number shows only chats WhatsApp
// reports; a different number archives them for good.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiddenChatsInfo, type Chat, type Message } from '@ezychat/shared';
import { FakeWaAdapter, LINKED_PHONE_CAPABILITIES, type WaIncomingMessage } from '@ezychat/wa';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { getChatHide, SHOWN_AUDIT_QUIET_MS } from '../src/chats/hide.js';
import { isChatHidden, LOGGED_OUT_MESSAGE } from '../src/chats/hidden-sql.js';
import { computeInboxStats } from '../src/chats/stats.js';
import { computeReport } from '../src/reports/report.js';
import { canOpenChat, usersWhoCanOpenChat } from '../src/inboxes/access.js';
import { findChats } from '../src/mcp/inbox.js';
import { linkedChats } from '../src/customers/linked.js';

const enc = encodeURIComponent;
const OWN = '60000000000@s.whatsapp.net';
const OTHER_OWN = '60999999999@s.whatsapp.net';
const A = '60111000001@s.whatsapp.net';
const B = '60111000002@s.whatsapp.net';
const C = '60111000003@s.whatsapp.net';
const G = '120363000000000001@g.us';

let t: TestApp;
let admin: { cookie: string; id: number };

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await t?.close();
});

async function setUp(opts: Parameters<typeof makeTestApp>[0] = {}) {
  t = await makeTestApp(opts);
  const a = await createUserAndLogin(t, { role: 'admin' });
  admin = { cookie: a.cookie, id: a.user.id };
}

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A live inbound message through a fake phone; returns the stored message. */
async function incoming(chatJid: string, body: string, wa: FakeWaAdapter = t.wa): Promise<Message> {
  const got = new Promise<Message>((resolve) => {
    const on = (m: Message) => {
      if (m.body === body && !m.fromMe) {
        t.ctx.bus.off('message:new', on);
        resolve(m);
      }
    };
    t.ctx.bus.on('message:new', on);
  });
  wa.simulateIncoming({ chatJid, body, senderName: 'Customer' });
  return got;
}

const historyMessage = (chatJid: string, id: string, body: string): WaIncomingMessage => ({
  id,
  chatJid,
  senderJid: chatJid,
  senderName: 'Customer',
  fromMe: false,
  type: 'text',
  body,
  quotedId: null,
  timestamp: Date.now() - 60_000,
  media: null,
});

const get = (url: string, cookie = admin.cookie) =>
  t.app.inject({ method: 'GET', url, headers: authHeaders(cookie) });
const post = (url: string, payload?: object, cookie = admin.cookie) =>
  t.app.inject({
    method: 'POST',
    url,
    headers: authHeaders(cookie),
    ...(payload ? { payload } : {}),
  });

const listed = async (cookie = admin.cookie, q = '') =>
  ((await get(`/api/chats${q}`, cookie)).json() as { chats: Chat[] }).chats.map((c) => c.jid);
const hiddenAt = (jid: string) =>
  (
    t.ctx.db.prepare('SELECT hidden_at FROM chats WHERE jid = ?').get(jid) as
      { hidden_at: number | null } | undefined
  )?.hidden_at;
const audits = (action: string) =>
  (
    t.ctx.db
      .prepare('SELECT user_id, meta FROM audit_log WHERE action = ? ORDER BY id')
      .all(action) as Array<{ user_id: number | null; meta: string }>
  ).map((r) => ({ userId: r.user_id, meta: JSON.parse(r.meta) as Record<string, unknown> }));
const info = async (inboxId = 1) =>
  HiddenChatsInfo.parse((await get(`/api/inboxes/${inboxId}/hidden-chats`)).json());

/** The phone links again (a scan) as `jid`. */
const link = (wa: FakeWaAdapter, jid: string) =>
  wa.simulateStatus({ state: 'open', me: { jid, name: 'Shop' }, qr: null, lastError: null });

describe('hide on Log out', { timeout: 30_000 }, () => {
  it("hides every chat on the admin's Log out and leaves them out for every reader", async () => {
    await setUp();
    const agent = await createUserAndLogin(t, { role: 'agent' });
    await incoming(A, 'hello from A');
    await incoming(B, 'hello from B');
    getChats(t.ctx).upsertFromWa({ jid: G, type: 'group', name: 'Staff' });
    expect(await info()).toEqual({ visible: 3, hidden: 0, number: null });
    // a queued send waits for the phone (offline): it must never go out later
    t.wa.setConnected(false);
    const queued = await post(`/api/chats/${enc(B)}/messages`, { text: 'waits', clientId: 'p2' });
    expect(queued.statusCode).toBe(201);
    const events: Array<{ inboxId: number }> = [];
    t.ctx.bus.on('chats:hidden', (p) => events.push(p));

    const r = await post('/api/wa/logout');
    expect(r.statusCode).toBe(200);

    expect([A, B, G].every((j) => hiddenAt(j) != null)).toBe(true);
    expect(events).toEqual([{ inboxId: 1 }]);
    expect(audits('chats.hidden_on_logout')).toEqual([
      { userId: null, meta: { inboxId: 1, count: 3, via: 'admin' } },
    ]);
    expect(await info()).toEqual({ visible: 0, hidden: 3, number: '60000000000' });
    const sendRow = getMessages(t.ctx).byClientId('p2');
    expect(sendRow).toMatchObject({ status: 'failed', error: LOGGED_OUT_MESSAGE });

    // list, search and tags: nothing, for admins and agents (Lite's one-inbox shortcut too)
    expect(await listed()).toEqual([]);
    expect(await listed(agent.cookie)).toEqual([]);
    expect(await listed(admin.cookie, '?q=60111')).toEqual([]);
    expect(getChats(t.ctx).openCount()).toBe(0);
    // open by id: 404, as a missing chat
    expect((await get(`/api/chats/${enc(A)}`)).statusCode).toBe(404);
    expect((await get(`/api/chats/${enc(A)}/messages`)).statusCode).toBe(404);
    expect((await get(`/api/messages/${enc(queued.json().id)}/edits`)).statusCode).toBe(404);
    // the central checks
    const adminUser = t.ctx.services.auth!.getUser(admin.id)!;
    expect(canOpenChat(t.ctx, adminUser, { jid: A, inbox_id: 1 })).toBe(false);
    expect(usersWhoCanOpenChat(t.ctx, A)).toEqual([]);
    // stats, reports and MCP tools
    const stats = computeInboxStats(t.ctx.db, {
      days: 1,
      timeZone: 'Asia/Kuala_Lumpur',
      now: Date.now(),
    });
    expect(stats.chats).toEqual({ open: 0, resolved: 0 });
    expect(stats.daily[0]).toMatchObject({ activeChats: 0, inbound: 0 });
    const report = computeReport(t.ctx.db, {
      days: 7,
      timeZone: 'Asia/Kuala_Lumpur',
      now: Date.now(),
    });
    expect(report.totals).toMatchObject({ messagesIn: 0, activeChats: 0, newCustomers: 0 });
    expect(findChats(t.ctx, A, adminUser)).toEqual([]);
    expect(findChats(t.ctx, '60111000001', adminUser)).toEqual([]);
    // sending into a hidden chat is refused like a missing chat (AI, scheduled tasks, MCP)
    expect(() => getMessages(t.ctx).sendText(A, { text: 'x', clientId: 'p3' }, admin.id)).toThrow(
      /Chat not found/,
    );
  });

  it('hides on an unlink from the phone (via phone) and a later Log out hides nothing twice', async () => {
    await setUp();
    await incoming(A, 'hello');
    t.wa.simulateStatus({ state: 'logged_out', me: null, qr: null });
    expect(hiddenAt(A)).not.toBeNull();
    expect(audits('chats.hidden_on_logout')).toEqual([
      { userId: null, meta: { inboxId: 1, count: 1, via: 'phone' } },
    ]);
    // the same state again (no change) and a Log out with nothing left: no second row
    t.wa.simulateStatus({ state: 'logged_out' });
    expect((await post('/api/wa/logout')).statusCode).toBe(200);
    expect(audits('chats.hidden_on_logout')).toHaveLength(1);
  });

  it('hides nothing on a connection drop or a reconnect', async () => {
    await setUp();
    await incoming(A, 'hello');
    t.wa.simulateStatus({ state: 'connecting' });
    t.wa.simulateStatus({ state: 'disconnected' });
    t.wa.setConnected(true);
    t.wa.simulateStatus({ state: 'replaced' });
    expect(hiddenAt(A)).toBeNull();
    expect(await listed()).toEqual([A]);
  });

  it('hides nothing for a connection that is not linked by QR (Business API)', async () => {
    const wa = new FakeWaAdapter({
      capabilities: { ...LINKED_PHONE_CAPABILITIES, qrLink: false },
    });
    await setUp({ wa });
    await incoming(A, 'hello', wa);
    wa.simulateStatus({ state: 'logged_out', me: null });
    expect(hiddenAt(A)).toBeNull();
    expect(audits('chats.hidden_on_logout')).toEqual([]);
  });

  it('hides nothing when an inbox is removed (its logout is ours) and only that inbox on Log out', async () => {
    await setUp({ maxInboxes: 3, inboxes: 3 });
    const wa2 = t.inboxWa(2);
    const wa3 = t.inboxWa(3);
    const m2 = await incoming(A, 'to inbox 2', wa2);
    const m3 = await incoming(A, 'to inbox 3', wa3);
    await incoming(B, 'to inbox 1');
    expect(
      (
        await t.app.inject({
          method: 'DELETE',
          url: '/api/inboxes/2',
          headers: authHeaders(admin.cookie),
        })
      ).statusCode,
    ).toBe(204);
    expect(hiddenAt(m2.chatJid)).toBeNull();
    expect((await post('/api/inboxes/3/wa/logout')).statusCode).toBe(200);
    expect(hiddenAt(m3.chatJid)).not.toBeNull();
    expect(hiddenAt(B)).toBeNull();
    expect(audits('chats.hidden_on_logout')).toEqual([
      { userId: null, meta: { inboxId: 3, count: 1, via: 'admin' } },
    ]);
    // a hidden chat is no linked chat of the same person in another inbox
    expect(linkedChats(t.ctx.db, m2.chatJid)).toEqual([]);
    expect((await get('/api/inboxes/99/hidden-chats')).statusCode).toBe(404);
  });
});

describe('edge cases', { timeout: 30_000 }, () => {
  it('Link again (relink) hides as the admin, and the same number shows reported chats', async () => {
    await setUp();
    await incoming(A, 'a1');
    expect((await post('/api/wa/relink')).statusCode).toBe(200);
    expect(audits('chats.hidden_on_logout')).toEqual([
      { userId: null, meta: { inboxId: 1, count: 1, via: 'admin' } },
    ]);
    // the fake phone links again at once with the same number
    t.wa.emit('chats', [{ jid: A, type: 'dm', name: null }]);
    expect(hiddenAt(A)).toBeNull();
  });

  it('records a later unlink from the phone as `phone` once the admin Log out finished', async () => {
    await setUp();
    const hide = getChatHide(t.ctx);
    const done = hide.markAdminLogout(1);
    done();
    await incoming(A, 'a1');
    expect(hide.hideInbox(1)).toBe(1);
    expect(audits('chats.hidden_on_logout')[0]!.meta.via).toBe('phone');
    // nothing left to hide: no row, no event
    const events: unknown[] = [];
    t.ctx.bus.on('chats:hidden', (p) => events.push(p));
    expect(hide.hideInbox(1)).toBe(0);
    expect(events).toEqual([]);
    expect(audits('chats.hidden_on_logout')).toHaveLength(1);
  });

  it('ignores reports that name no hidden chat and a link without a number', async () => {
    await setUp();
    await incoming(A, 'a1');
    await incoming(B, 'b1');
    const hide = getChatHide(t.ctx);
    hide.hideInbox(1);
    hide.onLinked(1, 'not-a-number@s.whatsapp.net');
    expect(hide.showIfHidden(1, [A])).toEqual([]);
    hide.onLinked(1, OWN);
    expect(hide.showIfHidden(1, [])).toEqual([]);
    expect(hide.showIfHidden(1, [null, undefined, 'bad#jid'])).toEqual([]);
    expect(hide.showIfHidden(1, [C])).toEqual([]);
    expect(hide.showIfHidden(1, [A])).toEqual([A]);
    // the last hidden chat of the number shows: nothing is looked for any more
    expect(hide.showIfHidden(1, [B])).toEqual([B]);
    expect(hide.showIfHidden(1, [B])).toEqual([]);
    hide.shutdown();
    expect(audits('chats.shown_on_relink')).toEqual([
      { userId: null, meta: { inboxId: 1, count: 2 } },
    ]);
  });

  it('hides the chats of an inbox without a connection (no send queue)', async () => {
    await setUp({ maxInboxes: 2, inboxes: 2 });
    const m = await incoming(A, 'to inbox 2', t.inboxWa(2));
    expect(
      (
        await t.app.inject({
          method: 'DELETE',
          url: '/api/inboxes/2',
          headers: authHeaders(admin.cookie),
        })
      ).statusCode,
    ).toBe(204);
    expect(getChatHide(t.ctx).hideInbox(2)).toBe(1);
    expect(hiddenAt(m.chatJid)).not.toBeNull();
  });

  it('keeps the bridge running when hiding or checking fails, and skips a replaced adapter', async () => {
    await setUp();
    await incoming(A, 'a1');
    const hide = getChatHide(t.ctx);
    // a status `open` without a number checks nothing
    const onLinked = vi.spyOn(hide, 'onLinked');
    t.wa.simulateStatus({ state: 'connecting' });
    t.wa.simulateStatus({ state: 'open', me: null });
    expect(onLinked).not.toHaveBeenCalled();
    onLinked.mockImplementation(() => {
      throw new Error('boom');
    });
    t.wa.simulateStatus({ state: 'connecting' });
    link(t.wa, OWN);
    expect(t.wa.status.state).toBe('open');
    // the inbox already uses another adapter (type change): that logout is ours, nothing hides
    const adapter = vi
      .spyOn(t.ctx.inboxes.connections, 'adapter')
      .mockReturnValue(new FakeWaAdapter());
    t.wa.simulateStatus({ state: 'logged_out', me: null });
    expect(hiddenAt(A)).toBeNull();
    adapter.mockRestore();
    vi.spyOn(hide, 'hideInbox').mockImplementation(() => {
      throw new Error('boom');
    });
    link(t.wa, OWN);
    t.wa.simulateStatus({ state: 'logged_out', me: null });
    expect(hiddenAt(A)).toBeNull();
  });
});

describe('the same number links again', { timeout: 30_000 }, () => {
  it('shows only the chats WhatsApp reports (chat list, history, live message) and audits once', async () => {
    await setUp();
    await incoming(A, 'a1');
    await incoming(B, 'b1');
    await incoming(C, 'c1');
    getChats(t.ctx).upsertFromWa({ jid: G, type: 'group', name: 'Staff' });
    const assigned = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(A)}`,
      headers: authHeaders(admin.cookie),
      payload: { assignedTo: admin.id },
    });
    expect(assigned.statusCode).toBe(200);
    expect((await post('/api/wa/logout')).statusCode).toBe(200);
    // nothing shows while logged out (the number is still remembered)
    getChatHide(t.ctx).showIfHidden(1, [A]);
    expect(hiddenAt(A)).not.toBeNull();

    const shown: string[] = [];
    t.ctx.bus.on('chat:updated', (c) => {
      if (!isChatHidden(t.ctx.db, c.jid)) shown.push(c.jid);
    });
    link(t.wa, OWN);
    // WhatsApp's chat list (history sync, chats.upsert, group list)
    t.wa.emit('chats', [
      { jid: A, type: 'dm', name: null },
      { jid: G, type: 'group', name: 'Staff' },
    ]);
    expect(hiddenAt(A)).toBeNull();
    expect(hiddenAt(G)).toBeNull();
    // a history message of B
    t.wa.emit('message', historyMessage(B, 'H-B1', 'old b'), { source: 'history' });
    await waitFor(() => hiddenAt(B) === null);
    expect(hiddenAt(C)).not.toBeNull();
    expect(new Set(await listed())).toEqual(new Set([A, B, G]));
    // the assignee and the history came back with the chat
    expect(getChats(t.ctx).get(A)?.assignedTo).toBe(admin.id);
    expect(
      getMessages(t.ctx)
        .list(A, { limit: 10 })
        .messages.map((m) => m.body),
    ).toContain('a1');
    expect(shown).toEqual(expect.arrayContaining([A, G, B]));

    getChatHide(t.ctx).flushShownAudit();
    expect(audits('chats.shown_on_relink')).toEqual([
      { userId: null, meta: { inboxId: 1, count: 3 } },
    ]);
    // C was never reported: a later live message from that person shows it
    await incoming(C, 'c2');
    expect(hiddenAt(C)).toBeNull();
    expect(
      getMessages(t.ctx)
        .list(C, { limit: 10 })
        .messages.map((m) => m.body)
        .sort(),
    ).toEqual(['c1', 'c2']);
    // Delete chat still works on a chat that came back
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/chats/${enc(C)}`,
      headers: authHeaders(admin.cookie),
    });
    expect(del.statusCode).toBe(204);
    expect(getChats(t.ctx).get(C)).toBeNull();
  });

  it('writes the shown audit row after a quiet period', async () => {
    await setUp();
    await incoming(A, 'a1');
    expect((await post('/api/wa/logout')).statusCode).toBe(200);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    link(t.wa, OWN);
    t.wa.emit('chats', [{ jid: A, type: 'dm', name: null }]);
    expect(audits('chats.shown_on_relink')).toEqual([]);
    vi.advanceTimersByTime(SHOWN_AUDIT_QUIET_MS + 1);
    expect(audits('chats.shown_on_relink')).toEqual([
      { userId: null, meta: { inboxId: 1, count: 1 } },
    ]);
  });
});

describe('a different number links', { timeout: 30_000 }, () => {
  it('archives the hidden chats for good; the same customer starts an empty chat', async () => {
    await setUp();
    await incoming(A, 'secret old order');
    const note = await post(`/api/chats/${enc(A)}/notes`, { body: 'VIP customer' });
    expect(note.statusCode).toBe(201);
    expect((await post('/api/wa/logout')).statusCode).toBe(200);

    link(t.wa, OTHER_OWN);
    expect(audits('chats.archived_on_relink')).toEqual([
      { userId: null, meta: { inboxId: 1, count: 1 } },
    ]);
    const archived = t.ctx.db
      .prepare('SELECT jid, wa_jid, hidden_at FROM chats WHERE inbox_id = 1')
      .all() as Array<{ jid: string; wa_jid: string; hidden_at: number | null }>;
    expect(archived).toEqual([
      { jid: `${A}~old1`, wa_jid: `${A}~old1`, hidden_at: expect.any(Number) },
    ]);
    // its messages and notes moved with it
    const moved = (table: string) =>
      (
        t.ctx.db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE chat_jid = ?`)
          .get(`${A}~old1`) as {
          n: number;
        }
      ).n;
    expect(moved('messages')).toBe(1);
    expect(moved('notes')).toBe(1);
    expect(await info()).toEqual({ visible: 0, hidden: 0, number: null });

    // WhatsApp reports the customer on the new number: a new, empty chat
    t.wa.emit('chats', [{ jid: A, type: 'dm', name: null }]);
    await incoming(A, 'hi new shop');
    expect(await listed()).toEqual([A]);
    expect(
      getMessages(t.ctx)
        .list(A, { limit: 10 })
        .messages.map((m) => m.body),
    ).toEqual(['hi new shop']);
    expect(isChatHidden(t.ctx.db, `${A}~old1`)).toBe(true);

    // the old number linking again later never brings an archived chat back
    expect((await post('/api/wa/logout')).statusCode).toBe(200);
    link(t.wa, OWN);
    expect(hiddenAt(`${A}~old1`)).not.toBeNull();
    // the second number's chat was archived too (another number), next to the first
    expect(
      (t.ctx.db.prepare('SELECT jid FROM chats ORDER BY jid').all() as Array<{ jid: string }>).map(
        (r) => r.jid,
      ),
    ).toEqual([`${A}~old1`, `${A}~old2`]);
    t.wa.emit('chats', [{ jid: A, type: 'dm', name: null }]);
    expect(hiddenAt(`${A}~old1`)).not.toBeNull();
    expect(hiddenAt(`${A}~old2`)).not.toBeNull();
  });

  it('archives chats of another inbox under a key that still names the inbox', async () => {
    await setUp({ maxInboxes: 2, inboxes: 2 });
    const wa2 = t.inboxWa(2);
    const m = await incoming(A, 'to inbox 2', wa2);
    expect(m.chatJid).toBe(`${A}#2`);
    expect((await post('/api/inboxes/2/wa/logout')).statusCode).toBe(200);
    link(wa2, OTHER_OWN);
    expect(hiddenAt(`${A}~old1#2`)).not.toBeNull();
    expect(usersWhoCanOpenChat(t.ctx, `${A}~old1#2`)).toEqual([]);
  });
});

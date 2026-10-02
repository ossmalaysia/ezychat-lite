import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Chat, Message } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from '../../test/helpers.js';
import { createPushService, type PushSender } from './service.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

function mkUser(name: string, role: 'admin' | 'agent' = 'agent') {
  return t.ctx.services.auth!.createUser({ username: name, displayName: name, role, password: 'password123', mustChangePassword: false });
}

const JID = '60123@s.whatsapp.net';
const chat = (assignedTo: number | null): Chat => ({
  jid: JID,
  type: 'dm',
  name: 'Alice',
  avatarUrl: null,
  unreadCount: 1,
  lastMessageAt: 1,
  lastMessagePreview: 'hello there',
  status: 'open',
  assignedTo,
  updatedAt: 1,
});
const message = { id: 'm1', chatJid: JID, body: 'hello there' } as Message;

function setup(online: Set<number>, fail?: (endpoint: string) => number | null) {
  const sent: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const sender: PushSender = async (sub, payload) => {
    const code = fail?.(sub.endpoint) ?? null;
    if (code) throw Object.assign(new Error('push failed'), { statusCode: code });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
  };
  const push = createPushService(t.ctx, { sender, isOnline: (id) => online.has(id) });
  return { push, sent };
}

const sub = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } });

describe('PushService', () => {
  it('generates and persists a VAPID key pair', () => {
    const { push } = setup(new Set());
    const key = push.publicKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    expect(t.ctx.settings.getSecret('vapid_private')).toBeTruthy();
    const { push: again } = setup(new Set());
    expect(again.publicKey()).toBe(key);
  });

  it('assignee online → no push', async () => {
    const a = mkUser('a1');
    const { push, sent } = setup(new Set([a.id]));
    push.subscribe(a.id, sub('a'));
    await push.notifyInbound(chat(a.id), message);
    expect(sent).toHaveLength(0);
  });

  it('assignee offline → push to assignee only', async () => {
    const a = mkUser('a1');
    const b = mkUser('b1');
    const { push, sent } = setup(new Set());
    push.subscribe(a.id, sub('a'));
    push.subscribe(b.id, sub('b'));
    await push.notifyInbound(chat(a.id), message);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/a']);
    expect(sent[0]!.payload).toEqual({
      title: 'Alice',
      body: 'hello there',
      url: `/chats/${encodeURIComponent(JID)}`,
      tag: JID,
    });
  });

  it('unassigned → all offline active users', async () => {
    const a = mkUser('a1');
    const b = mkUser('b1');
    const c = mkUser('c1');
    const d = mkUser('d1');
    const { push, sent } = setup(new Set([b.id]));
    for (const [u, n] of [
      [a, 'a'],
      [b, 'b'],
      [c, 'c'],
      [d, 'd'],
    ] as const)
      push.subscribe(u.id, sub(n));
    t.ctx.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(Date.now(), d.id);
    await push.notifyInbound(chat(null), message);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example/a', 'https://push.example/c']);
  });

  it('410/404 responses remove the subscription; other errors keep it', async () => {
    const a = mkUser('a1');
    const { push, sent } = setup(new Set(), (ep) =>
      ep.endsWith('/gone') ? 410 : ep.endsWith('/missing') ? 404 : ep.endsWith('/err') ? 500 : null,
    );
    push.subscribe(a.id, sub('gone'));
    push.subscribe(a.id, sub('missing'));
    push.subscribe(a.id, sub('err'));
    push.subscribe(a.id, sub('ok'));
    await push.notifyInbound(chat(null), message);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/ok']);
    const left = (
      t.ctx.db.prepare('SELECT endpoint FROM push_subscriptions ORDER BY endpoint').all() as Array<{ endpoint: string }>
    ).map((r) => r.endpoint);
    expect(left).toEqual(['https://push.example/err', 'https://push.example/ok']);
  });

  it('subscribe re-assigns an endpoint to the current user; unsubscribe only removes own', () => {
    const a = mkUser('a1');
    const b = mkUser('b1');
    const { push } = setup(new Set());
    push.subscribe(a.id, sub('x'));
    push.subscribe(b.id, sub('x'));
    expect(t.ctx.db.prepare('SELECT user_id FROM push_subscriptions').all()).toEqual([{ user_id: b.id }]);
    push.unsubscribe(a.id, 'https://push.example/x');
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 1 });
    push.unsubscribe(b.id, 'https://push.example/x');
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
  });

  it('notifyAdmins pushes to active admins only', async () => {
    const admin = mkUser('adm', 'admin');
    const agent = mkUser('agt', 'agent');
    const { push, sent } = setup(new Set());
    push.subscribe(admin.id, sub('adm'));
    push.subscribe(agent.id, sub('agt'));
    await push.notifyAdmins('WhatsApp logged out', 'Relink required');
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/adm']);
    expect(sent[0]!.payload.title).toBe('WhatsApp logged out');
  });

  it('routes bus inbound:notify and wa:status logged_out', async () => {
    const admin = mkUser('adm', 'admin');
    const { push, sent } = setup(new Set());
    push.subscribe(admin.id, sub('adm'));
    t.ctx.bus.emit('inbound:notify', { chat: chat(null), message });
    t.ctx.bus.emit('wa:status', { state: 'logged_out', me: null, qr: null, lastError: null });
    t.ctx.bus.emit('wa:status', { state: 'logged_out', me: null, qr: null, lastError: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBe(2);
    push.shutdown();
  });
});

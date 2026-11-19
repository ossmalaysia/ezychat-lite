// InboxManagePort directly (real app, fake WhatsApp, controllable clock): its own scope check (defence in
// depth behind the tool list), the per-token limits, how long a requestId is remembered, and inbox scope.
import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '@ezychat/shared';
import type { ApiPrincipal } from '../src/api-tokens/index.js';
import { createInboxManagePort, MANAGE_LIMITS, ManageError } from '../src/mcp/manage.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { waitFor } from './mcp-helpers.js';

const CHAT = '60123456789@s.whatsapp.net';
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const chats = () => (t!.ctx.db.prepare('SELECT COUNT(*) AS n FROM chats').get() as { n: number }).n;

function user(app: TestApp, username: string, role: 'admin' | 'agent'): User {
  return app.ctx.services.auth!.createUser({
    username,
    displayName: username,
    role,
    password: 'password123',
    mustChangePassword: false,
  });
}

const principal = (u: User, scopes: string[], tokenId = 7): ApiPrincipal => ({
  tokenId,
  user: u,
  scopes: new Set(scopes) as ApiPrincipal['scopes'],
});

async function setup() {
  t = await makeTestApp();
  const admin = user(t, 'owner', 'admin');
  t.wa.simulateIncoming({ chatJid: CHAT, body: 'Thanks!', senderName: 'Aminah' });
  await waitFor(() => chats() === 1);
  return { app: t, admin };
}

describe('InboxManagePort', () => {
  it('refuses a principal without inbox:manage even when called directly', async () => {
    const { app, admin } = await setup();
    const port = createInboxManagePort(app.ctx);
    expect(() =>
      port.resolveChat(principal(admin, ['inbox:read', 'inbox:send']), {
        chatId: CHAT,
        requestId: 'req-00000001',
      }),
    ).toThrow(ManageError);
    expect(
      (app.ctx.db.prepare('SELECT status FROM chats').get() as { status: string }).status,
    ).toBe('open');
  });

  it('allows 30 changes a minute and 300 a day per token, counted per token', async () => {
    const { app, admin } = await setup();
    let now = Date.parse('2026-11-19T08:00:00Z');
    const port = createInboxManagePort(app.ctx, { now: () => now });
    const p = principal(admin, ['inbox:manage']);
    let i = 0;
    const change = (who = p) =>
      (i % 2 ? port.reopenChat : port.resolveChat)(who, {
        chatId: CHAT,
        requestId: `req-limit-${i++}-x`,
      });
    for (let k = 0; k < MANAGE_LIMITS.perMinute.max; k++) change();
    expect(() => change()).toThrow(/a minute; try again in \d+ s/);
    // another token has its own count
    expect(() => change(principal(admin, ['inbox:manage'], 8))).not.toThrow();

    for (let k = MANAGE_LIMITS.perMinute.max; k < MANAGE_LIMITS.perDay.max; k++) {
      if (k % MANAGE_LIMITS.perMinute.max === 0) now += MANAGE_LIMITS.perMinute.windowMs;
      change();
    }
    now += MANAGE_LIMITS.perMinute.windowMs;
    expect(() => change()).toThrow(/a day; try again in \d+ s/);
    now += MANAGE_LIMITS.perDay.windowMs;
    expect(() => change()).not.toThrow();
  });

  it('remembers a requestId for a day: a later retry is a new change', async () => {
    const { app, admin } = await setup();
    let now = Date.parse('2026-11-19T08:00:00Z');
    const port = createInboxManagePort(app.ctx, { now: () => now });
    const p = principal(admin, ['inbox:manage']);
    const input = { chatId: CHAT, requestId: 'req-ttl-000001' };
    expect(port.resolveChat(p, input)).toMatchObject({ changed: true, duplicate: false });
    port.reopenChat(p, { chatId: CHAT, requestId: 'req-ttl-000002' });
    now += 60 * 60_000;
    expect(port.resolveChat(p, input)).toMatchObject({ duplicate: true });
    now += 24 * 60 * 60_000;
    expect(port.resolveChat(p, input)).toMatchObject({ changed: true, duplicate: false });
  });

  it('a chat of an inbox the owner may not open is "not found"; several matches are named', async () => {
    t = await makeTestApp({ maxInboxes: 3, inboxes: 2 });
    const app = t;
    const agent = user(app, 'siti', 'agent');
    app.ctx.inboxes.repo.setMembers(1, [agent.id]);
    app.ctx.inboxes.repo.setMembers(2, []);
    app.inboxWa(1).simulateIncoming({ chatJid: CHAT, body: 'one', senderName: 'A' });
    app.inboxWa(2).simulateIncoming({ chatJid: CHAT, body: 'two', senderName: 'A' });
    await waitFor(() => chats() === 2);
    const port = createInboxManagePort(app.ctx);
    // an agent's scope (a token owner is always an admin; the port still checks the scope it is given)
    const p = principal(agent, ['inbox:manage']);
    expect(() => port.resolveChat(p, { chatId: `${CHAT}#2`, requestId: 'req-scope-001' })).toThrow(
      `No chat found for ${CHAT}#2.`,
    );
    // the phone number names only the chat of inbox 1 for this agent
    expect(port.resolveChat(p, { chatId: CHAT, requestId: 'req-scope-002' })).toMatchObject({
      chatId: CHAT,
      changed: true,
    });
    // an admin sees both inboxes: a bare phone number is ambiguous and nothing is changed
    const admin = user(app, 'owner', 'admin');
    expect(() =>
      port.reopenChat(principal(admin, ['inbox:manage']), {
        chatId: '60123456789',
        requestId: 'req-scope-003',
      }),
    ).toThrow(/inbox_required/);
  });
});

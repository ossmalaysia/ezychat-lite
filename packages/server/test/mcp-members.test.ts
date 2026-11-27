// AI assistants (MCP) for team members (design docs/features/mcp-for-members/design.md): a member's
// token reaches exactly what that member can open in the app, rechecked live on every call, never AI
// setup, and stops when the admin switch goes off, the member is disabled or changes role.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@ezychat/shared';
import { NEW_CHAT_STAFF_KEY } from '../src/chats/new-chat.js';
import { setMcpEnabled, setMcpMembersEnabled } from '../src/mcp/settings.js';
import { authHeaders } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { data, mcpClient, rpc, waitFor } from './mcp-helpers.js';

const C = '60123456789@s.whatsapp.net'; // inbox 1
const C2 = `${C}#2`; // the same customer on inbox 2
const D2 = '60199999999@s.whatsapp.net#2'; // inbox 2, chosen for the limited member

let t: TestApp;
let admin: User;
let dan: User; // member of inbox 1
let ravi: User; // limited to the chosen chat D2
let adminCookie: string;
let danCookie: string;
let raviCookie: string;
const mcp = mcpClient(() => t);

const chatCount = (jid: string) =>
  (t.ctx.db.prepare('SELECT COUNT(*) AS n FROM chats WHERE jid = ?').get(jid) as { n: number }).n;
const messageIn = (jid: string) =>
  (
    t.ctx.db.prepare('SELECT id FROM messages WHERE chat_jid = ? LIMIT 1').get(jid) as {
      id: string;
    }
  ).id;
const toolNames = async (secret: string) =>
  ((await mcp.post(rpc('tools/list'), secret)).json().result.tools as Array<{ name: string }>).map(
    (x) => x.name,
  );
const status = async (secret: string) => (await mcp.post(rpc('tools/list'), secret)).statusCode;

function user(username: string, role: 'admin' | 'agent'): User {
  return t.ctx.services.auth!.createUser({
    username,
    displayName: username,
    role,
    password: 'password123',
    mustChangePassword: false,
  });
}
const cookieOf = (u: User) =>
  `sid=${t.ctx.services.auth!.createSession(u.id, { ip: '127.0.0.1', userAgent: 't' })}`;

let app = 0;
/**
 * A member's token as their app sign-in issues it (members never create access tokens by hand), with
 * Can send ticked on the approval page when asked.
 */
function memberToken(u: User, opts: { canSend?: boolean } = {}) {
  return t.ctx.services.apiTokens!.createForApp(
    u.id,
    { clientId: `ezc_app_test${++app}`, name: `${u.username}-app` },
    'ip',
    { canSend: opts.canSend ?? false },
  );
}

let n = 0;
const requestId = () => `req-member-${++n}-abcdef`;

beforeAll(async () => {
  t = await makeTestApp({ listen: true, maxInboxes: 3, inboxes: 2 });
  admin = user('owner', 'admin');
  dan = user('dan', 'agent');
  ravi = user('ravi', 'agent');
  adminCookie = cookieOf(admin);
  danCookie = cookieOf(dan);
  raviCookie = cookieOf(ravi);
  t.ctx.inboxes.repo.setMembers(1, [dan.id]);
  t.ctx.inboxes.repo.setMembers(2, []);
  setMcpEnabled(t.ctx, true);
  setMcpMembersEnabled(t.ctx, true);
  t.inboxWa(1).simulateIncoming({ chatJid: C, body: 'Hi one', senderName: 'Aminah' });
  t.inboxWa(2).simulateIncoming({ chatJid: C, body: 'Hi two', senderName: 'Aminah' });
  t.inboxWa(2).simulateIncoming({
    chatJid: '60199999999@s.whatsapp.net',
    body: 'Another',
    senderName: 'Ben',
  });
  await waitFor(() => chatCount(C) === 1 && chatCount(C2) === 1 && chatCount(D2) === 1);
  t.ctx.db.prepare("UPDATE users SET chat_scope = 'chosen' WHERE id = ?").run(ravi.id);
  t.ctx.db
    .prepare(
      'INSERT INTO member_chats (user_id, chat_jid, added_by, added_at) VALUES (?, ?, NULL, ?)',
    )
    .run(ravi.id, D2, Date.now());
});
afterAll(async () => {
  await t.close();
});

describe('a member token', () => {
  it('lists chat tools only: no AI setup, no counts, send only with Can send', async () => {
    const read = memberToken(dan).secret;
    const names = await toolNames(read);
    expect([...names].sort()).toEqual([
      'get_chat',
      'get_message_file',
      'get_messages',
      'list_chats',
    ]);
    // counts are admins only over MCP (owner decision 2026-11-20)
    expect((await mcp.call('get_stats', {}, read)).isError).toBe(true);
    expect(names.some((x) => x.includes('ai_') || x === 'try_ai_reply')).toBe(false);
    expect(names).not.toContain('send_message');
    const send = memberToken(dan, { canSend: true }).secret;
    expect(await toolNames(send)).toContain('send_message');
  });

  it('drops a stored ai:setup scope at resolve time (defence in depth)', async () => {
    const { token, secret } = memberToken(dan);
    t.ctx.db
      .prepare("UPDATE api_tokens SET scopes = 'inbox:read ai:setup' WHERE id = ?")
      .run(token.id);
    const names = await toolNames(secret);
    expect(names).not.toContain('update_ai_setup');
    expect(names).not.toContain('list_ai_agents');
    const r = await mcp.call('update_ai_setup', { field: 'instructions', text: 'x' }, secret);
    expect(r.isError).toBe(true);
  });

  it("reads only the member's inboxes: another inbox's chat is not found", async () => {
    const secret = memberToken(dan).secret;
    const list = data(await mcp.call('list_chats', {}, secret));
    expect(list.chats.map((c: { jid: string }) => c.jid)).toEqual([C]);
    expect((await mcp.call('get_chat', { jid: C }, secret)).isError).toBeFalsy();
    for (const [tool, args] of [
      ['get_chat', { jid: C2 }],
      ['get_messages', { jid: C2 }],
      ['get_chat', { jid: D2 }],
    ] as const) {
      const r = await mcp.call(tool, args, secret);
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/No chat found/);
    }
    // a phone number resolves only inside the member's inboxes (no inbox_required hint)
    expect(data(await mcp.call('get_chat', { jid: '60123456789' }, secret)).chat.jid).toBe(C);
    const file = await mcp.call('get_message_file', { messageId: messageIn(C2) }, secret);
    expect(file.content[0]!.text).toMatch(/No message found/);
    const own = await mcp.call('get_message_file', { messageId: messageIn(C) }, secret);
    expect(own.content[0]!.text).toMatch(/no file/);
  });

  it('a member limited to chosen chats reads only those chats', async () => {
    const secret = memberToken(ravi).secret;
    const names = await toolNames(secret);
    expect(names).not.toContain('get_stats');
    expect(names).not.toContain('get_activity');
    const list = data(await mcp.call('list_chats', {}, secret));
    expect(list.chats.map((c: { jid: string }) => c.jid)).toEqual([D2]);
    expect((await mcp.call('get_chat', { jid: D2 }, secret)).isError).toBeFalsy();
    for (const id of [C, C2]) {
      const r = await mcp.call('get_chat', { jid: id }, secret);
      expect(r.content[0]!.text).toMatch(/No chat found/);
    }
    expect(
      (await mcp.call('get_message_file', { messageId: messageIn(C) }, secret)).content[0]!.text,
    ).toMatch(/No message found/);
    // called directly anyway: refused
    expect((await mcp.call('get_stats', {}, secret)).isError).toBe(true);
  });

  it('sends only into existing chats the member can open, as the member', async () => {
    const dSend = memberToken(dan, { canSend: true }).secret;
    const ok = await mcp.call(
      'send_message',
      { jid: C, text: 'From Dan', requestId: requestId() },
      dSend,
    );
    expect(ok.isError).toBeFalsy();
    const row = t.ctx.db
      .prepare('SELECT sent_by_user_id AS by FROM messages WHERE body = ?')
      .get('From Dan') as { by: number };
    expect(row.by).toBe(dan.id);
    const audited = t.ctx.db
      .prepare("SELECT user_id FROM audit_log WHERE action = 'mcp.send' ORDER BY id DESC")
      .get() as { user_id: number };
    expect(audited.user_id).toBe(dan.id);

    const refused = await mcp.call(
      'send_message',
      { jid: C2, text: 'Nope', requestId: requestId() },
      dSend,
    );
    expect(refused.content[0]!.text).toMatch(/No chat found/);

    const rSend = memberToken(ravi, { canSend: true }).secret;
    expect(
      (
        await mcp.call(
          'send_message',
          { jid: D2, text: 'From Ravi', requestId: requestId() },
          rSend,
        )
      ).isError,
    ).toBeFalsy();
    const outside = await mcp.call(
      'send_message',
      { jid: C, text: 'x', requestId: requestId() },
      rSend,
    );
    expect(outside.content[0]!.text).toMatch(/No chat found/);
    expect(mcp.count('SELECT COUNT(*) AS n FROM messages WHERE body IN (?, ?)', 'Nope', 'x')).toBe(
      0,
    );
  });

  it('may message new numbers only while the member could start a new chat in the app', async () => {
    const tokens = t.ctx.services.apiTokens!;
    // ticked later on the member's own list of connected apps (owner only)
    const allowNew = (u: User) => {
      const made = memberToken(u, { canSend: true });
      return {
        ...made,
        token: tokens.updatePermissions(
          made.token.id,
          u.id,
          { canSend: true, canMessageNewNumbers: true },
          'ip',
        ),
      };
    };
    expect(() => allowNew(dan)).toThrow(/cannot start new chats/);
    t.ctx.settings.set(NEW_CHAT_STAFF_KEY, true);
    const ok = allowNew(dan);
    expect(ok.token.canMessageNewNumbers).toBe(true);
    expect(await toolNames(ok.secret)).toContain('send_to_new_number');
    // a member limited to chosen chats never starts new chats
    expect(() => allowNew(ravi)).toThrow(/cannot start new chats/);
    // the switch going off again stops it on the next call (rechecked by the New chat service)
    t.ctx.settings.set(NEW_CHAT_STAFF_KEY, false);
    const r = await mcp.call(
      'send_to_new_number',
      { phone: '60111222333', text: 'Hello', requestId: requestId() },
      ok.secret,
    );
    expect(r.isError).toBe(true);
    expect(chatCount('60111222333@s.whatsapp.net')).toBe(0);
  });

  it("follows the member's live access: removed from an inbox, the chat is gone", async () => {
    const secret = memberToken(dan).secret;
    expect((await mcp.call('get_chat', { jid: C }, secret)).isError).toBeFalsy();
    t.ctx.inboxes.repo.setMembers(1, []);
    try {
      expect((await mcp.call('get_chat', { jid: C }, secret)).content[0]!.text).toMatch(
        /No chat found/,
      );
      expect(data(await mcp.call('list_chats', {}, secret)).chats).toEqual([]);
    } finally {
      t.ctx.inboxes.repo.setMembers(1, [dan.id]);
    }
    // an unchosen chat is gone for the limited member on the next call too
    const r = memberToken(ravi).secret;
    t.ctx.db.prepare('DELETE FROM member_chats WHERE user_id = ?').run(ravi.id);
    try {
      expect((await mcp.call('get_chat', { jid: D2 }, r)).content[0]!.text).toMatch(
        /No chat found/,
      );
    } finally {
      t.ctx.db
        .prepare(
          'INSERT INTO member_chats (user_id, chat_jid, added_by, added_at) VALUES (?, ?, NULL, ?)',
        )
        .run(ravi.id, D2, Date.now());
    }
  });
});

describe('stopping a member token', () => {
  it('turning AI assistant access off also revokes members, and members cannot be armed while off', async () => {
    const member = memberToken(dan).secret;
    const adminTok = t.ctx.services.apiTokens!.create(
      admin.id,
      { name: 'keep', expiresInDays: 90 },
      'ip',
    );
    const patch = (payload: Record<string, boolean>) =>
      t.app.inject({
        method: 'PATCH',
        url: '/api/integrations/mcp',
        headers: authHeaders(adminCookie),
        payload,
      });
    const off = await patch({ enabled: false });
    expect(off.json()).toMatchObject({ enabled: false, membersEnabled: false });
    const armed = await patch({ membersEnabled: true });
    expect(armed.statusCode).toBe(409);
    const on = await patch({ enabled: true, membersEnabled: true });
    expect(on.json()).toMatchObject({ enabled: true, membersEnabled: true });
    expect(await status(member)).toBe(401);
    expect(await status(adminTok.secret)).toBe(200);
  });

  it('stops at once when the member is disabled', async () => {
    const temp = user('temp1', 'agent');
    const secret = memberToken(temp).secret;
    expect(await status(secret)).toBe(200);
    t.ctx.services.auth!.updateUser(temp.id, { disabled: true }, admin.id);
    expect(await status(secret)).toBe(401);
  });

  it('a role change either way revokes the tokens', async () => {
    const temp = user('temp2', 'agent');
    const { secret } = memberToken(temp);
    t.ctx.services.auth!.updateUser(temp.id, { role: 'admin' }, admin.id);
    // a member token never silently becomes an admin's
    expect(await status(secret)).toBe(401);
    const adminTok = t.ctx.services.apiTokens!.create(
      temp.id,
      { name: 'a', expiresInDays: 90 },
      'ip',
    );
    t.ctx.services.auth!.updateUser(temp.id, { role: 'agent' }, admin.id);
    expect(await status(adminTok.secret)).toBe(401);
  });

  it('the admin switch going off revokes every member token, never an admin token', async () => {
    const member = memberToken(dan).secret;
    const own = t.ctx.services.apiTokens!.create(
      admin.id,
      { name: 'own', expiresInDays: 90 },
      'ip',
    );
    const off = await t.app.inject({
      method: 'PATCH',
      url: '/api/integrations/mcp',
      headers: authHeaders(adminCookie),
      payload: { membersEnabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().membersEnabled).toBe(false);
    expect(await status(member)).toBe(401);
    expect(await status(own.secret)).toBe(200);
    const row = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'settings.mcp_members' ORDER BY id DESC")
      .get() as { meta: string };
    expect(JSON.parse(row.meta)).toMatchObject({ before: true, after: false });
    expect(JSON.parse(row.meta).revokedTokens).toBeGreaterThan(0);
    // and while it is off a stored member token is refused even if not revoked
    t.ctx.db.prepare('UPDATE api_tokens SET revoked_at = NULL WHERE user_id = ?').run(dan.id);
    expect(await status(member)).toBe(401);
    const on = await t.app.inject({
      method: 'PATCH',
      url: '/api/integrations/mcp',
      headers: authHeaders(adminCookie),
      payload: { membersEnabled: true },
    });
    expect(on.json()).toMatchObject({ membersEnabled: true, canConnect: true });
    t.ctx.db.prepare('UPDATE api_tokens SET revoked_at = 1 WHERE user_id = ?').run(dan.id);
  });
});

describe('token pages for members', () => {
  it('a member lists, changes and revokes only their own tokens', async () => {
    const mine = memberToken(dan);
    const adminTok = t.ctx.services.apiTokens!.create(
      admin.id,
      { name: 'adm', expiresInDays: 90 },
      'ip',
    );
    const list = await t.app.inject({
      method: 'GET',
      url: '/api/integrations/tokens',
      headers: authHeaders(danCookie),
    });
    const ids = list.json().tokens.map((x: { id: number }) => x.id);
    expect(ids).toContain(mine.token.id);
    expect(ids).not.toContain(adminTok.token.id);
    expect(list.json().tokens.every((x: { userId: number }) => x.userId === dan.id)).toBe(true);

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/integrations/tokens/${adminTok.token.id}`,
      headers: authHeaders(danCookie),
    });
    expect(del.statusCode).toBe(404);
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/integrations/tokens/${adminTok.token.id}`,
      headers: authHeaders(danCookie),
      payload: { canSend: true, canMessageNewNumbers: false },
    });
    // another person's token reads as missing for a member, as on DELETE
    expect(patch.statusCode).toBe(404);

    const allow = await t.app.inject({
      method: 'PATCH',
      url: `/api/integrations/tokens/${mine.token.id}`,
      headers: authHeaders(danCookie),
      payload: { canSend: true, canMessageNewNumbers: false },
    });
    expect(allow.json().token.canSend).toBe(true);

    // resolving chats (`inbox:manage`) is admin-only: refused, and the stored scopes stay unchanged
    const resolve = await t.app.inject({
      method: 'PATCH',
      url: `/api/integrations/tokens/${mine.token.id}`,
      headers: authHeaders(danCookie),
      payload: { canSend: true, canMessageNewNumbers: false, canResolveChats: true },
    });
    expect(resolve.statusCode).toBe(403);
    const scopes = (
      t.ctx.db.prepare('SELECT scopes FROM api_tokens WHERE id = ?').get(mine.token.id) as {
        scopes: string;
      }
    ).scopes;
    expect(scopes.split(' ')).not.toContain('inbox:manage');

    // the admin sees every token, the member's marked
    const all = await t.app.inject({
      method: 'GET',
      url: '/api/integrations/tokens',
      headers: authHeaders(adminCookie),
    });
    const theirs = all.json().tokens.find((x: { id: number }) => x.id === mine.token.id);
    expect(theirs).toMatchObject({ memberToken: true, userName: 'dan' });
    const adminRevokes = await t.app.inject({
      method: 'DELETE',
      url: `/api/integrations/tokens/${mine.token.id}`,
      headers: authHeaders(adminCookie),
    });
    expect(adminRevokes.statusCode).toBe(204);
  });

  it('a member never creates a personal access token (admins only, owner decision)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/integrations/tokens',
      headers: authHeaders(raviCookie),
      payload: { name: 'Claude', canSend: true },
    });
    expect(res.statusCode).toBe(403);
    expect(() =>
      t.ctx.services.apiTokens!.create(dan.id, { name: 'x', expiresInDays: 90 }, 'ip'),
    ).toThrow(/for admins/);
    expect(
      mcp.count(
        'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND oauth_client_id IS NULL',
        ravi.id,
      ),
    ).toBe(0);
  });

  it('shows a member canConnect false while AI assistant access itself is off', async () => {
    setMcpEnabled(t.ctx, false);
    try {
      const settings = await t.app.inject({
        method: 'GET',
        url: '/api/integrations/mcp',
        headers: authHeaders(danCookie),
      });
      expect(settings.json()).toMatchObject({ canConnect: false, canMessageNewNumbers: false });
    } finally {
      setMcpEnabled(t.ctx, true);
    }
  });
});

describe('app sign-in (OAuth) as a member', () => {
  const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
  const VERIFIER = 'v'.repeat(43) + '-verifier_0123456789';
  const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
  const local = { remoteAddress: '127.0.0.1' };

  async function register() {
    const res = await t.app.inject({
      method: 'POST',
      url: '/mcp/oauth/register',
      ...local,
      headers: { host: 'localhost', 'content-type': 'application/json' },
      payload: JSON.stringify({
        redirect_uris: [REDIRECT],
        client_name: 'Claude',
        token_endpoint_auth_method: 'none',
      }),
    });
    return res.json().client_id as string;
  }
  const params = (clientId: string) => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st-1',
    resource: 'http://localhost/mcp',
  });
  const decide = (p: Record<string, string>, cookie: string, extra: { canSend?: boolean } = {}) =>
    t.app.inject({
      method: 'POST',
      url: '/api/oauth/decision',
      ...local,
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        cookie,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ ...p, approve: true, ...extra }),
    });

  it('approves for the member only; the app token reads only their chats and cannot send', async () => {
    const clientId = await register();
    const res = await decide(params(clientId), danCookie);
    expect(res.statusCode).toBe(200);
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    const tok = await t.app.inject({
      method: 'POST',
      url: '/mcp/oauth/token',
      ...local,
      headers: { host: 'localhost', 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        resource: 'http://localhost/mcp',
      }).toString(),
    });
    expect(tok.statusCode).toBe(200);
    const secret = tok.json().access_token as string;
    const row = t.ctx.db
      .prepare('SELECT user_id, scopes FROM api_tokens WHERE oauth_client_id = ?')
      .get(clientId) as { user_id: number; scopes: string };
    expect(row).toEqual({ user_id: dan.id, scopes: 'inbox:read' });
    const names = await toolNames(secret);
    expect(names).not.toContain('send_message');
    expect(names).not.toContain('update_ai_setup');
    expect(
      data(await mcp.call('list_chats', {}, secret)).chats.map((c: { jid: string }) => c.jid),
    ).toEqual([C]);
  });

  it('Can send ticked on the approval page gives the app send access, nothing more', async () => {
    const clientId = await register();
    const res = await decide(params(clientId), raviCookie, { canSend: true });
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    const tok = await t.app.inject({
      method: 'POST',
      url: '/mcp/oauth/token',
      ...local,
      headers: { host: 'localhost', 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        resource: 'http://localhost/mcp',
      }).toString(),
    });
    const row = t.ctx.db
      .prepare('SELECT user_id, scopes FROM api_tokens WHERE oauth_client_id = ?')
      .get(clientId) as { user_id: number; scopes: string };
    expect(row).toEqual({ user_id: ravi.id, scopes: 'inbox:read inbox:send' });
    const secret = tok.json().access_token as string;
    const outside = await mcp.call(
      'send_message',
      { jid: C, text: 'x', requestId: requestId() },
      secret,
    );
    expect(outside.content[0]!.text).toMatch(/No chat found/);
    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'mcp.app_approve' ORDER BY id DESC")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta)).toMatchObject({ clientId, canSend: true });
  });

  it('refuses the approve page while members may not connect', async () => {
    const clientId = await register();
    setMcpMembersEnabled(t.ctx, false);
    try {
      const res = await decide(params(clientId), danCookie);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('mcp_members_off');
      const info = await t.app.inject({
        method: 'GET',
        url: `/api/oauth/request?${new URLSearchParams(params(clientId))}`,
        ...local,
        headers: { host: 'localhost', cookie: danCookie },
      });
      expect(info.statusCode).toBe(403);
    } finally {
      setMcpMembersEnabled(t.ctx, true);
    }
  });

  const exchange = (clientId: string, code: string) =>
    t.app.inject({
      method: 'POST',
      url: '/mcp/oauth/token',
      ...local,
      headers: { host: 'localhost', 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        resource: 'http://localhost/mcp',
      }).toString(),
    });

  it('a code a member approved never becomes an admin token after a promotion', async () => {
    const temp = user('temp-promoted', 'agent');
    const clientId = await register();
    const res = await decide(params(clientId), cookieOf(temp));
    expect(res.statusCode).toBe(200);
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    t.ctx.services.auth!.updateUser(temp.id, { role: 'admin' }, admin.id);
    const tok = await exchange(clientId, code);
    expect(tok.statusCode).toBe(400);
    expect(tok.json().error).toBe('invalid_grant');
    const rows = t.ctx.db
      .prepare('SELECT scopes FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .all(temp.id);
    expect(rows).toEqual([]);
  });

  it('members switched off and on again: a code approved before is dropped', async () => {
    const clientId = await register();
    const res = await decide(params(clientId), danCookie);
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    for (const membersEnabled of [false, true]) {
      const patch = await t.app.inject({
        method: 'PATCH',
        url: '/api/integrations/mcp',
        headers: authHeaders(adminCookie),
        payload: { membersEnabled },
      });
      expect(patch.statusCode).toBe(200);
    }
    const tok = await exchange(clientId, code);
    expect(tok.statusCode).toBe(400);
    expect(tok.json().error).toBe('invalid_grant');
  });

  it("an admin's approved code survives the members switch going off", async () => {
    const clientId = await register();
    const res = await decide(params(clientId), adminCookie);
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    expect(t.ctx.services.mcpOAuth!.dropMemberCodes()).toBe(0);
    const tok = await exchange(clientId, code);
    expect(tok.statusCode).toBe(200);
  });

  it('a code approved by a member who then loses access is refused at exchange', async () => {
    const clientId = await register();
    const res = await decide(params(clientId), danCookie);
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    setMcpMembersEnabled(t.ctx, false);
    try {
      const tok = await t.app.inject({
        method: 'POST',
        url: '/mcp/oauth/token',
        ...local,
        headers: { host: 'localhost', 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: REDIRECT,
          code_verifier: VERIFIER,
          resource: 'http://localhost/mcp',
        }).toString(),
      });
      expect(tok.statusCode).toBe(400);
      expect(tok.json().error).toBe('invalid_grant');
    } finally {
      setMcpMembersEnabled(t.ctx, true);
    }
  });
});

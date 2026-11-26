// Changing what an existing access token may do (PATCH /api/integrations/tokens/:id): only its owner, in
// a session, never through a token; audited with before/after; the MCP tool list follows at once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@ezychat/shared';
import { setMcpEnabled } from '../src/mcp/settings.js';
import { authHeaders } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { mcpClient, rpc } from './mcp-helpers.js';

let t: TestApp;
let owner: User;
let ownerCookie: string;
let otherCookie: string;
let secret: string;
let tokenId: number;

const mcp = mcpClient(() => t);

const patch = (id: number, payload: unknown, cookie = ownerCookie) =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/integrations/tokens/${id}`,
    headers: authHeaders(cookie),
    payload: payload as Record<string, unknown>,
  });

const toolNames = async () =>
  ((await mcp.post(rpc('tools/list'), secret)).json().result.tools as Array<{ name: string }>).map(
    (x) => x.name,
  );

beforeAll(async () => {
  t = await makeTestApp();
  const auth = t.ctx.services.auth!;
  const create = (username: string) =>
    auth.createUser({
      username,
      displayName: username,
      role: 'admin',
      password: 'password123',
      mustChangePassword: false,
    });
  owner = create('owner');
  const other = create('other');
  ownerCookie = `sid=${auth.createSession(owner.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  otherCookie = `sid=${auth.createSession(other.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  const created = t.ctx.services.apiTokens!.create(
    owner.id,
    { name: 'Claude – office', expiresInDays: 90 },
    'ip',
  );
  secret = created.secret;
  tokenId = created.token.id;
  setMcpEnabled(t.ctx, true);
});
afterAll(async () => {
  await t.close();
});

describe('changing a token’s permissions', () => {
  it('the owner turns sending on and off; the tool list follows on the next call', async () => {
    expect(await toolNames()).not.toContain('send_message');

    const on = await patch(tokenId, { canSend: true, canMessageNewNumbers: true });
    expect(on.statusCode).toBe(200);
    expect(on.json().token).toMatchObject({ canSend: true, canMessageNewNumbers: true });
    expect(await toolNames()).toEqual(
      expect.arrayContaining(['send_message', 'send_to_new_number', 'list_chats']),
    );

    const off = await patch(tokenId, { canSend: false, canMessageNewNumbers: false });
    expect(off.json().token).toMatchObject({ canSend: false, canMessageNewNumbers: false });
    const names = await toolNames();
    expect(names).not.toContain('send_message');
    // The read and AI setup tools stay.
    expect(names).toEqual(expect.arrayContaining(['list_chats', 'get_ai_agent_setup']));
  });

  it('audits each change with the permissions before and after', async () => {
    await patch(tokenId, { canSend: true, canMessageNewNumbers: false });
    const row = t.ctx.db
      .prepare(
        "SELECT user_id AS userId, meta FROM audit_log WHERE action = 'api_token.update' ORDER BY id DESC LIMIT 1",
      )
      .get() as { userId: number; meta: string };
    expect(row.userId).toBe(owner.id);
    expect(JSON.parse(row.meta)).toMatchObject({
      tokenId,
      before: { canSend: false, canMessageNewNumbers: false },
      after: { canSend: true, canMessageNewNumbers: false },
    });
  });

  it('refuses new numbers without sending, another admin, unknown and expired tokens', async () => {
    expect((await patch(tokenId, { canSend: false, canMessageNewNumbers: true })).statusCode).toBe(
      400,
    );
    expect((await patch(tokenId, { canSend: true })).statusCode).toBe(400);
    const foreign = await patch(
      tokenId,
      { canSend: true, canMessageNewNumbers: true },
      otherCookie,
    );
    expect(foreign.statusCode).toBe(403);
    expect((await patch(9999, { canSend: true, canMessageNewNumbers: false })).statusCode).toBe(
      404,
    );

    const old = t.ctx.services.apiTokens!.create(
      owner.id,
      { name: 'old', expiresInDays: 30 },
      'ip',
    ).token;
    t.ctx.db
      .prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1, old.id);
    expect((await patch(old.id, { canSend: true, canMessageNewNumbers: false })).statusCode).toBe(
      400,
    );
    t.ctx.services.apiTokens!.revoke(old.id, owner, 'ip');
    expect((await patch(old.id, { canSend: true, canMessageNewNumbers: false })).statusCode).toBe(
      404,
    );
  });

  it('a token can never change its own permissions (/api refuses bearer tokens)', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/integrations/tokens/${tokenId}`,
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        authorization: `Bearer ${secret}`,
      },
      payload: { canSend: true, canMessageNewNumbers: true },
    });
    expect(res.statusCode).toBe(401);
  });

  // Another admin's own token: PATCH is limited to 10 a minute per admin, and the owner used most.
  let theirs: { id: number; secret: string };
  const theirTools = async () =>
    (
      (await mcp.post(rpc('tools/list'), theirs.secret)).json().result.tools as Array<{
        name: string;
      }>
    ).map((x) => x.name);

  it('"Can resolve chats" is its own permission: on, kept when omitted, off; audited; tools follow', async () => {
    const other = t.ctx.services.auth!.listUsers().find((u) => u.username === 'other')!;
    const made = t.ctx.services.apiTokens!.create(
      other.id,
      { name: 'theirs', expiresInDays: 90 },
      'ip',
    );
    theirs = { id: made.token.id, secret: made.secret };
    const toolNames = theirTools;
    const patch = (_id: number, payload: unknown) =>
      t.app.inject({
        method: 'PATCH',
        url: `/api/integrations/tokens/${theirs.id}`,
        headers: authHeaders(otherCookie),
        payload: payload as Record<string, unknown>,
      });
    const tokenId = theirs.id;
    await patch(tokenId, { canSend: false, canMessageNewNumbers: false });
    expect(await toolNames()).not.toContain('resolve_chat');

    const on = await patch(tokenId, {
      canSend: false,
      canMessageNewNumbers: false,
      canResolveChats: true,
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().token).toMatchObject({ canSend: false, canResolveChats: true });
    const names = await toolNames();
    expect(names).toEqual(expect.arrayContaining(['resolve_chat', 'reopen_chat']));
    expect(names).not.toContain('send_message');

    // an older client that does not know the field never takes it away
    const kept = await patch(tokenId, { canSend: true, canMessageNewNumbers: false });
    expect(kept.json().token).toMatchObject({ canSend: true, canResolveChats: true });
    // and turning sending off leaves it on
    const sendOff = await patch(tokenId, { canSend: false, canMessageNewNumbers: false });
    expect(sendOff.json().token).toMatchObject({ canSend: false, canResolveChats: true });

    const off = await patch(tokenId, {
      canSend: false,
      canMessageNewNumbers: false,
      canResolveChats: false,
    });
    expect(off.json().token.canResolveChats).toBe(false);
    expect(await toolNames()).not.toContain('resolve_chat');

    const row = t.ctx.db
      .prepare(
        "SELECT meta FROM audit_log WHERE action = 'api_token.update' ORDER BY id DESC LIMIT 1",
      )
      .get() as { meta: string };
    expect(JSON.parse(row.meta)).toMatchObject({
      before: { canResolveChats: true },
      after: { canResolveChats: false },
    });
  });

  it('another admin cannot grant it, nor can a token', async () => {
    const body = { canSend: false, canMessageNewNumbers: false, canResolveChats: true };
    // the owner of the first token is not the owner of this one
    expect((await patch(theirs.id, body)).statusCode).toBe(403);
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/integrations/tokens/${theirs.id}`,
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        authorization: `Bearer ${theirs.secret}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(
      t.ctx.services.apiTokens!.list({ id: 0, role: 'admin' }).find((x) => x.id === theirs.id)
        ?.canResolveChats,
    ).toBe(false);
  });

  it('is off for new tokens and app sign-ins unless ticked at creation, and audited there', () => {
    const tokens = t.ctx.services.apiTokens!;
    expect(tokens.create(owner.id, { name: 'plain', expiresInDays: 30 }, 'ip').token).toMatchObject(
      { canResolveChats: false },
    );
    const app = tokens.createForApp(owner.id, { clientId: 'client-1', name: 'Claude' }, 'ip');
    expect(app.token).toMatchObject({ canSend: false, canResolveChats: false, connectedApp: true });
    const ticked = tokens.create(
      owner.id,
      { name: 'triage', expiresInDays: 30, canResolveChats: true },
      'ip',
    );
    expect(ticked.token).toMatchObject({ canSend: false, canResolveChats: true });
    const row = t.ctx.db
      .prepare(
        "SELECT meta FROM audit_log WHERE action = 'api_token.create' ORDER BY id DESC LIMIT 1",
      )
      .get() as { meta: string };
    expect(JSON.parse(row.meta)).toMatchObject({ name: 'triage', canResolveChats: true });
  });
});

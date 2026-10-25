import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { User } from '@ezychat/shared';
import { setMcpEnabled } from '../src/mcp/settings.js';
import { makeTestApp, type TestApp } from './helpers.js';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(43) + '-verifier_0123456789';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let t: TestApp;
let admin: User;
let agent: User;
let adminCookie: string;
let agentCookie: string;

const local = { remoteAddress: '127.0.0.1', headers: { host: 'localhost' } };
// Registration allows 10 a minute per client IP: each test registration comes through the tunnel
// from its own address.
let nextIp = 0;
const tunnelFrom = () => ({ 'cf-connecting-ip': `198.51.100.${++nextIp % 250}` });

function register(body: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url: '/mcp/oauth/register',
    remoteAddress: local.remoteAddress,
    headers: { host: 'localhost', 'content-type': 'application/json', ...tunnelFrom() },
    payload: JSON.stringify(body),
  });
}

async function newClient(extra: Record<string, unknown> = {}) {
  const res = await register({
    redirect_uris: [REDIRECT],
    client_name: 'Claude',
    token_endpoint_auth_method: 'none',
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { client_id: string; client_secret?: string };
}

const authParams = (clientId: string, over: Record<string, string> = {}) => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'st-1',
  resource: 'http://localhost/mcp',
  ...over,
});

function requestInfo(params: Record<string, string>, cookie = adminCookie) {
  return t.app.inject({
    method: 'GET',
    url: `/api/oauth/request?${new URLSearchParams(params)}`,
    ...local,
    headers: { host: 'localhost', cookie },
  });
}

function decide(params: Record<string, string>, approve: boolean, cookie = adminCookie) {
  return t.app.inject({
    method: 'POST',
    url: '/api/oauth/decision',
    remoteAddress: local.remoteAddress,
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      cookie,
      'content-type': 'application/json',
    },
    payload: JSON.stringify({ ...params, approve }),
  });
}

async function approvedCode(clientId: string) {
  const res = await decide(authParams(clientId), true);
  expect(res.statusCode).toBe(200);
  const to = new URL(res.json().redirectTo);
  return to.searchParams.get('code')!;
}

function token(form: Record<string, string>, headers: Record<string, string> = {}) {
  return t.app.inject({
    method: 'POST',
    url: '/mcp/oauth/token',
    remoteAddress: local.remoteAddress,
    headers: {
      host: 'localhost',
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    payload: new URLSearchParams(form).toString(),
  });
}

const exchangeForm = (clientId: string, code: string, over: Record<string, string> = {}) => ({
  grant_type: 'authorization_code',
  client_id: clientId,
  code,
  redirect_uri: REDIRECT,
  code_verifier: VERIFIER,
  resource: 'http://localhost/mcp',
  ...over,
});

beforeAll(async () => {
  t = await makeTestApp({ listen: true });
  const auth = t.ctx.services.auth!;
  admin = auth.createUser({
    username: 'owner',
    displayName: 'Owner',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  agent = auth.createUser({
    username: 'agent',
    displayName: 'Agent',
    role: 'agent',
    password: 'password123',
    mustChangePassword: false,
  });
  adminCookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  agentCookie = `sid=${auth.createSession(agent.id, { ip: '127.0.0.1', userAgent: 't' })}`;
});
afterAll(async () => t?.close());
beforeEach(() => setMcpEnabled(t.ctx, true));

describe('MCP sign-in with the real MCP SDK client', () => {
  class TestProvider implements OAuthClientProvider {
    client?: OAuthClientInformationMixed;
    saved?: OAuthTokens;
    verifier = '';
    authUrl?: URL;
    get redirectUrl() {
      return 'http://localhost:3999/callback';
    }
    get clientMetadata(): OAuthClientMetadata {
      return {
        redirect_uris: [this.redirectUrl],
        client_name: 'SDK Assistant',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    }
    clientInformation() {
      return this.client;
    }
    saveClientInformation(info: OAuthClientInformationMixed) {
      this.client = info;
    }
    tokens() {
      return this.saved;
    }
    saveTokens(tokens: OAuthTokens) {
      this.saved = tokens;
    }
    redirectToAuthorization(url: URL) {
      this.authUrl = url;
    }
    saveCodeVerifier(v: string) {
      this.verifier = v;
    }
    codeVerifier() {
      return this.verifier;
    }
  }

  it('discovers, registers, gets approved by the admin and calls a tool with the issued token', async () => {
    const provider = new TestProvider();
    const endpoint = new URL(`${t.url}/mcp`);
    const first = new StreamableHTTPClientTransport(endpoint, { authProvider: provider });
    await expect(new Client({ name: 'sdk', version: '1' }).connect(first)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    // The SDK found the approval page through /.well-known and registered itself.
    const authUrl = provider.authUrl!;
    expect(authUrl.pathname).toBe('/oauth/authorize');
    expect(authUrl.searchParams.get('resource')).toBe(`${t.url}/mcp`);

    // What the approval page does in the admin's browser.
    const params = Object.fromEntries(authUrl.searchParams);
    const info = await fetch(`${t.url}/api/oauth/request?${authUrl.searchParams}`, {
      headers: { cookie: adminCookie },
    });
    expect(await info.json()).toEqual({
      clientName: 'SDK Assistant',
      redirectHost: 'localhost:3999',
    });
    const decision = await fetch(`${t.url}/api/oauth/decision`, {
      method: 'POST',
      headers: { cookie: adminCookie, origin: t.url!, 'content-type': 'application/json' },
      body: JSON.stringify({ ...params, approve: true }),
    });
    expect(decision.status).toBe(200);
    const back = new URL(((await decision.json()) as { redirectTo: string }).redirectTo);
    expect(back.origin + back.pathname).toBe('http://localhost:3999/callback');
    expect(back.searchParams.get('state')).toBe(params.state ?? null);

    await first.finishAuth(back.searchParams.get('code')!);
    expect(provider.saved?.access_token).toMatch(/^ezc_pat_/);
    expect(provider.saved?.token_type).toBe('Bearer');

    const client = new Client({ name: 'sdk', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(endpoint, { authProvider: provider }));
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name)).toContain('list_chats');
    // Like a Settings token, minus sending: the admin can allow that later.
    expect(tools.map((x) => x.name)).not.toContain('send_message');
    await client.close();

    const listed = t.ctx.services.apiTokens!.list().find((x) => x.name === 'SDK Assistant')!;
    expect(listed).toMatchObject({
      userId: admin.id,
      expiresAt: null,
      canSend: false,
      connectedApp: true,
    });
    // A token made in Settings is not marked as a connected app.
    const made = t.ctx.services.apiTokens!.create(
      admin.id,
      { name: 'cli', expiresInDays: 30 },
      'ip',
    );
    expect(made.token.connectedApp).toBe(false);
  });
});

describe('discovery', () => {
  it('serves the protected resource and authorization server metadata for the request host', async () => {
    const pr = await t.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource/mcp',
      ...local,
    });
    expect(pr.json()).toMatchObject({
      resource: 'http://localhost/mcp',
      authorization_servers: ['http://localhost'],
    });
    const root = await t.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
      ...local,
    });
    expect(root.json()).toEqual(pr.json());

    // Through the tunnel the addresses are https.
    const as = await t.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
      remoteAddress: '127.0.0.1',
      headers: { host: 'localhost', 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(as.statusCode).toBe(200);
    expect(as.json()).toMatchObject({
      issuer: 'https://localhost',
      authorization_endpoint: 'https://localhost/oauth/authorize',
      token_endpoint: 'https://localhost/mcp/oauth/token',
      registration_endpoint: 'https://localhost/mcp/oauth/register',
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('points the 401 of /mcp at the metadata', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      ...local,
      headers: { host: 'localhost', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('is invisible while AI assistant access is off and refuses a LAN peer', async () => {
    setMcpEnabled(t.ctx, false);
    const off = await t.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
      ...local,
    });
    expect(off.statusCode).toBe(404);
    expect((await register({ redirect_uris: [REDIRECT] })).statusCode).toBe(404);
    setMcpEnabled(t.ctx, true);
    const lan = await t.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
      remoteAddress: '192.168.1.20',
      headers: { host: '192.168.1.5' },
    });
    expect(lan.statusCode).toBe(403);
  });
});

describe('registration', () => {
  it('accepts https, loopback http and app schemes, and refuses the rest', async () => {
    for (const uri of ['http://localhost:9/cb', 'http://127.0.0.1:9/cb', 'cursor://app/cb']) {
      expect(
        (await register({ redirect_uris: [uri], token_endpoint_auth_method: 'none' })).statusCode,
      ).toBe(201);
    }
    for (const uri of [
      'http://evil.example/cb',
      'javascript:alert(1)',
      'data:text/html,x',
      'https://claude.ai/cb#frag',
      'not a url',
    ]) {
      const res = await register({ redirect_uris: [uri] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_redirect_uri');
    }
    expect((await register({})).statusCode).toBe(400);
    const method = await register({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'private_key_jwt',
    });
    expect(method.json().error).toBe('invalid_client_metadata');
    const grants = await register({
      redirect_uris: [REDIRECT],
      grant_types: ['client_credentials'],
    });
    expect(grants.json().error).toBe('invalid_client_metadata');
  });

  it('issues a secret to confidential clients (client_secret_basic by default)', async () => {
    const res = await register({ redirect_uris: [REDIRECT], client_name: ' Chat\u0007GPT ' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toMatchObject({
      token_endpoint_auth_method: 'client_secret_basic',
      client_name: 'Chat GPT',
    });
    expect(body.client_secret).toMatch(/^ezc_app_secret_/);
  });

  it('removes apps that never got a token after a day', async () => {
    t.ctx.db
      .prepare(
        `INSERT INTO oauth_clients (id, name, redirect_uris, auth_method, created_at)
         VALUES ('stale', 'old', '[]', 'none', ?)`,
      )
      .run(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await newClient();
    expect(
      t.ctx.db.prepare("SELECT COUNT(*) FROM oauth_clients WHERE id = 'stale'").pluck().get(),
    ).toBe(0);
  });
});

describe('approval page API', () => {
  it('shows the app and where it returns to', async () => {
    const { client_id } = await newClient();
    const res = await requestInfo(authParams(client_id));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ clientName: 'Claude', redirectHost: 'claude.ai' });
    // One registered address: the app may leave redirect_uri out.
    const { redirect_uri: _omit, ...rest } = authParams(client_id);
    expect((await requestInfo(rest)).statusCode).toBe(200);
  });

  it('refuses requests it cannot trust, never redirecting', async () => {
    const { client_id } = await newClient();
    const bad = [
      authParams('unknown'),
      authParams(client_id, { redirect_uri: 'https://evil.example/cb' }),
      authParams(client_id, { code_challenge_method: 'plain' }),
      authParams(client_id, { code_challenge: 'short' }),
      authParams(client_id, { response_type: 'token' }),
      authParams(client_id, { resource: 'https://other.example/mcp' }),
    ];
    for (const params of bad) expect((await requestInfo(params)).statusCode).toBe(400);
  });

  it('needs a signed-in admin and AI assistant access turned on', async () => {
    const { client_id } = await newClient();
    expect((await requestInfo(authParams(client_id), agentCookie)).statusCode).toBe(403);
    expect((await decide(authParams(client_id), true, agentCookie)).statusCode).toBe(403);
    expect((await requestInfo(authParams(client_id), '')).statusCode).toBe(401);
    setMcpEnabled(t.ctx, false);
    expect((await requestInfo(authParams(client_id))).statusCode).toBe(409);
    expect((await decide(authParams(client_id), true)).statusCode).toBe(409);
  });

  it('sends the browser back with access_denied when the admin declines', async () => {
    const { client_id } = await newClient();
    const res = await decide(authParams(client_id), false);
    const back = new URL(res.json().redirectTo);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('st-1');
    expect(back.searchParams.get('code')).toBeNull();
    const row = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'mcp.app_deny' ORDER BY id DESC")
      .pluck()
      .get() as string;
    expect(JSON.parse(row)).toEqual({ clientId: client_id, redirectHost: 'claude.ai' });
  });

  it('refuses a cross-site approval (Origin check)', async () => {
    const { client_id } = await newClient();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/oauth/decision',
      remoteAddress: '127.0.0.1',
      headers: {
        host: 'localhost',
        origin: 'https://evil.example',
        cookie: adminCookie,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ ...authParams(client_id), approve: true }),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('token endpoint', () => {
  it('swaps a code once, for the right verifier only', async () => {
    const { client_id } = await newClient();
    const code = await approvedCode(client_id);
    const wrong = await token(exchangeForm(client_id, code, { code_verifier: 'w'.repeat(43) }));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('invalid_grant');
    // The failed try used the code up.
    expect((await token(exchangeForm(client_id, code))).json().error).toBe('invalid_grant');

    const ok = await token(exchangeForm(client_id, await approvedCode(client_id)));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.json()).toEqual({
      access_token: expect.stringMatching(/^ezc_pat_/),
      token_type: 'Bearer',
    });
  });

  it('checks the redirect address, the resource, the client and the grant type', async () => {
    const { client_id } = await newClient();
    const other = await newClient();
    const cases: Array<[Record<string, string>, string]> = [
      [{ redirect_uri: 'https://claude.ai/other' }, 'invalid_grant'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
      [{ client_id: other.client_id }, 'invalid_grant'],
      [{ grant_type: 'refresh_token' }, 'unsupported_grant_type'],
      [{ client_id: 'nobody' }, 'invalid_client'],
    ];
    for (const [over, error] of cases) {
      const res = await token(exchangeForm(client_id, await approvedCode(client_id), over));
      expect(res.json().error, JSON.stringify(over)).toBe(error);
    }
  });

  it('authenticates confidential clients with Basic or the form', async () => {
    const reg = await newClient({ token_endpoint_auth_method: 'client_secret_basic' });
    const basic = `Basic ${Buffer.from(`${reg.client_id}:${reg.client_secret}`).toString('base64')}`;
    const { client_id: _id, ...noId } = exchangeForm(
      reg.client_id,
      await approvedCode(reg.client_id),
    );
    expect((await token(noId, { authorization: basic })).statusCode).toBe(200);

    const wrong = `Basic ${Buffer.from(`${reg.client_id}:nope`).toString('base64')}`;
    const denied = await token(noId, { authorization: wrong });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error).toBe('invalid_client');

    const post = await newClient({ token_endpoint_auth_method: 'client_secret_post' });
    const form = exchangeForm(post.client_id, await approvedCode(post.client_id));
    expect((await token(form)).statusCode).toBe(401);
    expect(
      (
        await token({
          ...form,
          code: await approvedCode(post.client_id),
          client_secret: post.client_secret!,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('replaces the app’s earlier token when the admin connects it again', async () => {
    const { client_id } = await newClient({ client_name: 'Reconnect' });
    await token(exchangeForm(client_id, await approvedCode(client_id)));
    await token(exchangeForm(client_id, await approvedCode(client_id)));
    const mine = t.ctx.services.apiTokens!.list().filter((x) => x.name === 'Reconnect');
    expect(mine).toHaveLength(1);
  });

  it('names the token after the return host when the app gave no name', async () => {
    const reg = await register({
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'none',
    });
    const id = reg.json().client_id as string;
    const params = authParams(id, {
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    });
    const code = new URL((await decide(params, true)).json().redirectTo).searchParams.get('code')!;
    const res = await token(exchangeForm(id, code, { redirect_uri: params.redirect_uri }));
    expect(res.statusCode).toBe(200);
    expect(t.ctx.services.apiTokens!.list().some((x) => x.name === 'chatgpt.com')).toBe(true);
  });

  it('refuses the code when the approving admin lost the admin role meanwhile', async () => {
    const auth = t.ctx.services.auth!;
    const other = auth.createUser({
      username: 'admin2',
      displayName: 'Admin 2',
      role: 'admin',
      password: 'password123',
      mustChangePassword: false,
    });
    const cookie = `sid=${auth.createSession(other.id, { ip: '127.0.0.1', userAgent: 't' })}`;
    const { client_id } = await newClient();
    const res = await decide(authParams(client_id), true, cookie);
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    t.ctx.db.prepare("UPDATE users SET role = 'agent' WHERE id = ?").run(other.id);
    const swap = await token(exchangeForm(client_id, code));
    expect(swap.statusCode).toBe(400);
    expect(swap.json().error).toBe('invalid_grant');
  });
});

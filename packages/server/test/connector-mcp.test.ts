// Partner (MCP) connections from the connector list: the five sign-in types against the local
// partner MCP test server (https, loopback allowed only through the test allowance), Test
// connection, Disconnect, per-agent settings, Activity, choices and the routes' access rules.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ConnectorEntry,
  type ConnectorConnectResult,
  type ConnectorGallery,
} from '@ezychat/shared';
import { listAgents } from '../src/ai/agents.js';
import type { AppContext } from '../src/context.js';
import {
  createConnectorMcpService,
  type ConnectorMcpOptions,
} from '../src/connectors/mcp/service.js';
import type { ConnectorListService } from '../src/connectors/list/types.js';
import { partnerEntries } from '../../../e2e/partner-mcp/list.mjs';
import {
  completeConsent,
  PARTNER_CREDENTIALS,
  startPartnerMcp,
  type PartnerKit,
} from '../../../e2e/partner-mcp/server.mjs';
import { request } from 'node:https';
import {
  iconContentOk,
  parseEntries,
  publicKeys,
  sha256,
  signatureValid,
} from '../src/connectors/list/verify.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

let kit: PartnerKit;
let t: TestApp;
let cookie: string;
let entries: ConnectorEntry[];
const ALLOW = { CONNECTORS_TEST_ALLOW_LOCAL: '1' };

beforeAll(async () => {
  kit = await startPartnerMcp({ port: 0, tls: true });
});
afterAll(async () => {
  await kit.close();
});
afterEach(async () => {
  await t?.close();
});

/** A stand-in for the list module (agent A): the test partners, editable per test. */
function fakeList(): ConnectorListService {
  return {
    status: () => ({
      state: 'loaded',
      generatedAt: null,
      sequence: 1,
      checkedAt: null,
      appVersion: '0.0.0-test',
      hidden: 0,
    }),
    entry: (id) => entries.find((e) => e.id === id) ?? null,
    gallery: () => ({ connectors: [] }) as unknown as ConnectorGallery,
    refresh: async () => ({ connectors: [] }) as unknown as ConnectorGallery,
    shutdown: () => undefined,
  };
}

async function setUp(options: ConnectorMcpOptions = { env: ALLOW }) {
  entries = (partnerEntries(kit.origin) as unknown[]).map((e) => ConnectorEntry.parse(e));
  t = await makeTestApp({
    beforeBuild: (ctx: AppContext) => {
      ctx.services.connectorList = fakeList();
      const service = createConnectorMcpService(ctx, { net: { ca: kit.cert }, ...options });
      ctx.services.connectorMcp = service;
      ctx.services.connectorConnections = service.port;
    },
  });
  ({ cookie } = await createUserAndLogin(t, { role: 'admin' }));
}

const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, as = cookie) =>
  t.app.inject({ method, url: `/api/connectors/mcp${url}`, headers: authHeaders(as), payload });

const connect = (id: string, fields: Record<string, string> = {}) =>
  api('POST', `/${id}/connect`, { fields });
const svc = () => t.ctx.services.connectorMcp!;
const auditActions = () =>
  (
    t.ctx.db.prepare('SELECT action FROM audit_log ORDER BY id').all() as Array<{ action: string }>
  ).map((r) => r.action);

/** Starts an OAuth sign-in, presses Allow/Cancel on the partner page and lands on our callback. */
async function signIn(
  id: string,
  fields: Record<string, string> = {},
  decision: 'allow' | 'cancel' = 'allow',
) {
  const res = await connect(id, fields);
  expect(res.statusCode, res.body).toBe(200);
  const start = res.json() as ConnectorConnectResult;
  const back = await completeConsent(start.authorizationUrl!, decision, kit.cert);
  const page = await t.app.inject({ method: 'GET', url: `${back.pathname}${back.search}` });
  return { start, page };
}

describe('access', () => {
  it('answers 401 without a session and 403 for a teammate, on every route', async () => {
    await setUp();
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const routes: Array<['GET' | 'POST' | 'PUT', string]> = [
      ['POST', '/test-kedai/connect'],
      ['GET', '/test-kedai/connect/0123456789abcdef0123456789abcdef'],
      ['POST', '/test-kedai/test'],
      ['POST', '/test-kedai/disconnect'],
      ['GET', '/test-kedai/agents/1'],
      ['PUT', '/test-kedai/agents/1'],
      ['GET', '/test-kedai/activity'],
      ['GET', '/test-kedai/choices/priceList'],
    ];
    for (const [method, url] of routes) {
      const anonymous = await t.app.inject({
        method,
        url: `/api/connectors/mcp${url}`,
        headers: authHeaders('sid=none'),
        payload: {},
      });
      expect(anonymous.statusCode, url).toBe(401);
      expect((await api(method, url, {}, agent.cookie)).statusCode, url).toBe(403);
    }
  });

  it('checks ids and refuses connectors that are not partner entries of the list', async () => {
    await setUp();
    expect((await connect('Bad_Id')).statusCode).toBe(400);
    expect((await connect('not-listed')).statusCode).toBe(404);
    entries.push(ConnectorEntry.parse({ ...entries[0], id: 'test-soon', kind: 'coming_soon' }));
    expect((await connect('test-soon')).statusCode).toBe(404);
    expect((await api('GET', '/test-kedai/connect/xyz')).statusCode).toBe(400);
    expect(
      (await api('GET', '/test-kedai/connect/0123456789abcdef0123456789abcdef')).statusCode,
    ).toBe(404);
    expect((await api('POST', '/test-kedai/test')).statusCode).toBe(404);
    expect((await api('POST', '/test-kedai/disconnect')).statusCode).toBe(404);
    expect((await api('GET', '/test-kedai/choices/priceList')).statusCode).toBe(404);
    expect((await api('GET', '/not-listed/activity')).statusCode).toBe(404);
  });

  it('never reaches this computer without the test allowance', async () => {
    await setUp({ env: {} });
    const res = await connect('test-kedai', { key: PARTNER_CREDENTIALS.apiKey });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('private_address');
    expect(kit.state.calls).toEqual([]);
  });

  it('limits connect and test to 10 a minute per admin', async () => {
    await setUp();
    for (let i = 0; i < 10; i++)
      expect((await api('POST', '/test-kedai/test', { fields: { key: 'wrong' } })).statusCode).toBe(
        200,
      );
    expect((await api('POST', '/test-kedai/test', { fields: { key: 'wrong' } })).statusCode).toBe(
      429,
    );
  });
});

describe('api_key', () => {
  it('tests a key before saving, refuses a wrong one and keeps only the last 4 characters visible', async () => {
    await setUp();
    expect(
      (await api('POST', '/test-kedai/test', { fields: { key: 'wrong-key' } })).json(),
    ).toEqual({
      ok: false,
      tools: [],
      problem: 'refused',
    });
    expect(
      (
        await api('POST', '/test-kedai/test', { fields: { key: PARTNER_CREDENTIALS.apiKey } })
      ).json(),
    ).toEqual({
      ok: true,
      tools: ['find_invoice', 'check_stock', 'list_price_lists', 'create_quotation'],
      problem: null,
    });
    expect(svc().port.view('test-kedai')).toBeNull();
    const refused = await connect('test-kedai', { key: 'wrong-key' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('refused');
    expect((await connect('test-kedai', { key: 'two words' })).statusCode).toBe(400);
    expect((await connect('test-kedai', {})).statusCode).toBe(400);

    const res = await connect('test-kedai', { key: PARTNER_CREDENTIALS.apiKey });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      authorizationUrl: null,
      requestId: null,
      connection: {
        state: 'connected',
        account: null,
        keyEnd: '4242',
        connectedAt: expect.any(Number),
        fields: {},
      },
    });
    const row = t.ctx.db.prepare('SELECT * FROM connector_connections').get() as Record<
      string,
      string
    >;
    expect(JSON.stringify(row)).not.toContain(PARTNER_CREDENTIALS.apiKey);
    expect(JSON.parse(row.tools_json!).map((tool: { name: string }) => tool.name)).toEqual([
      'find_invoice',
      'check_stock',
      'list_price_lists',
      'create_quotation',
    ]);
    expect(svc().port.saved()).toEqual([{ id: 'test-kedai', entry: entries[1] }]);
    expect(auditActions()).toContain('connector.connect');

    // Test connection of the saved one
    expect((await api('POST', '/test-kedai/test')).json()).toMatchObject({
      ok: true,
      problem: null,
    });
    kit.setState('api-key', 'down');
    expect((await api('POST', '/test-kedai/test')).json()).toEqual({
      ok: false,
      tools: [],
      problem: 'unreachable',
    });
    expect(svc().port.view('test-kedai')!.state).toBe('unreachable');
    kit.setState('api-key', 'refused');
    expect((await api('POST', '/test-kedai/test')).json()).toMatchObject({ problem: 'refused' });
    expect(svc().port.view('test-kedai')!.state).toBe('needs_sign_in');
    kit.setState('api-key', 'ok');
    expect((await api('POST', '/test-kedai/test')).json()).toMatchObject({ ok: true });
    expect(svc().port.view('test-kedai')!.state).toBe('connected');
  });

  it('refuses a partner that lacks a tool the entry lists', async () => {
    await setUp();
    const kedai = entries[1]!;
    kedai.tools = [...kedai.tools!, { ...kedai.tools![0]!, name: 'ghost_tool' }];
    const res = await connect('test-kedai', { key: PARTNER_CREDENTIALS.apiKey });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('missing_tools');
    expect(
      (
        await api('POST', '/test-kedai/test', { fields: { key: PARTNER_CREDENTIALS.apiKey } })
      ).json(),
    ).toEqual({
      ok: false,
      tools: [],
      problem: 'missing_tools',
    });
  });

  it('reports an unreachable partner', async () => {
    await setUp();
    kit.setState('api-key', 'down');
    try {
      const res = await connect('test-kedai', { key: PARTNER_CREDENTIALS.apiKey });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe('unreachable');
    } finally {
      kit.setState('api-key', 'ok');
    }
  });
});

describe('credentials and none', () => {
  it('sends the declared headers (Basic of two fields), shows non-secret fields only', async () => {
    await setUp();
    expect((await connect('test-gudang', { account: 'acme', username: 'demo' })).statusCode).toBe(
      400,
    );
    const wrong = await connect('test-gudang', {
      account: 'acme',
      username: 'demo',
      password: 'nope',
    });
    expect(wrong.json().error.code).toBe('refused');
    const res = await connect('test-gudang', {
      account: PARTNER_CREDENTIALS.account,
      username: PARTNER_CREDENTIALS.username,
      password: PARTNER_CREDENTIALS.password,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connection).toMatchObject({
      state: 'connected',
      keyEnd: '9876',
      fields: { account: 'acme', username: 'demo' },
    });
    expect((await api('POST', '/test-gudang/test')).json()).toMatchObject({ ok: true });
  });

  it('connects a public server with no sign-in', async () => {
    await setUp();
    const res = await connect('test-open');
    expect(res.json().connection).toMatchObject({ state: 'connected', keyEnd: null });
    expect((await api('POST', '/test-open/test')).json()).toEqual({
      ok: true,
      tools: ['check_stock', 'list_price_lists'],
      problem: null,
    });
  });
});

describe('oauth', () => {
  it('registers itself, signs in with PKCE, saves the grant and refreshes it', async () => {
    await setUp();
    const res = await connect('test-lejar');
    const start = res.json() as ConnectorConnectResult;
    expect(start.authorizationUrl).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/oauth\/authorize\?/);
    const page = new URL(start.authorizationUrl!);
    expect(page.searchParams.get('code_challenge_method')).toBe('S256');
    expect(page.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/api\/connectors\/mcp\/oauth\/callback$/,
    );
    expect(page.searchParams.get('scope')).toBe('invoices.read stock.read quotes.write');
    expect(start.connection.state).toBe('waiting');
    expect((await api('GET', `/test-lejar/connect/${start.requestId}`)).json()).toEqual({
      status: 'pending',
      problem: null,
    });
    expect((await api('GET', `/test-kedai/connect/${start.requestId}`)).statusCode).toBe(404);

    const back = await completeConsent(start.authorizationUrl!, 'allow', kit.cert);
    // Only this computer may finish the sign-in.
    const remote = await t.app.inject({
      method: 'GET',
      url: `${back.pathname}${back.search}`,
      remoteAddress: '10.1.2.3',
    });
    expect(remote.statusCode).toBe(403);
    const done = await t.app.inject({ method: 'GET', url: `${back.pathname}${back.search}` });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.body).toContain('Lejar Accounting (test) connected');
    expect(done.headers['content-security-policy']).toContain("default-src 'none'");
    // The state is single use.
    expect(
      (await t.app.inject({ method: 'GET', url: `${back.pathname}${back.search}` })).statusCode,
    ).toBe(400);
    expect((await api('GET', `/test-lejar/connect/${start.requestId}`)).json()).toEqual({
      status: 'done',
      problem: null,
    });
    expect(svc().port.view('test-lejar')).toMatchObject({ state: 'connected', keyEnd: null });
    const row = t.ctx.db.prepare('SELECT secret FROM connector_connections').get() as {
      secret: string;
    };
    expect(row.secret).not.toContain('at_');

    // The access token stops working: Test refreshes once and works again.
    kit.expireAccessTokens('oauth');
    expect((await api('POST', '/test-lejar/test')).json()).toMatchObject({ ok: true });
    expect(svc().port.view('test-lejar')!.state).toBe('connected');

    // The grant is revoked at the partner: needs a new sign-in.
    kit.setState('oauth', 'refused');
    expect((await api('POST', '/test-lejar/test')).json()).toMatchObject({
      ok: false,
      problem: 'refused',
    });
    expect(svc().port.view('test-lejar')!.state).toBe('needs_sign_in');
    kit.setState('oauth', 'ok');
  });

  it('refreshes an access token that ran out before using it', async () => {
    let now = Date.now();
    await setUp({ env: ALLOW, now: () => now });
    await signIn('test-lejar');
    now += 10 * 60_000; // past expires_in (300 s)
    expect((await api('POST', '/test-lejar/test')).json()).toMatchObject({ ok: true });
  });

  it('reports a cancelled sign-in and an expired one', async () => {
    let now = Date.now();
    await setUp({ env: ALLOW, now: () => now });
    const { start, page } = await signIn('test-lejar', {}, 'cancel');
    expect(page.statusCode).toBe(400);
    expect((await api('GET', `/test-lejar/connect/${start.requestId}`)).json()).toEqual({
      status: 'failed',
      problem: 'cancelled',
    });
    expect(svc().port.view('test-lejar')).toBeNull();

    const late = (await connect('test-lejar')).json() as ConnectorConnectResult;
    expect(svc().port.view('test-lejar')!.state).toBe('waiting');
    now += 11 * 60_000;
    expect((await api('GET', `/test-lejar/connect/${late.requestId}`)).json()).toEqual({
      status: 'failed',
      problem: 'expired',
    });
    expect(svc().port.view('test-lejar')).toBeNull();
    const back = await completeConsent(late.authorizationUrl!, 'allow', kit.cert);
    expect(
      (await t.app.inject({ method: 'GET', url: `${back.pathname}${back.search}` })).statusCode,
    ).toBe(400);
  });

  it('answers a forged or empty callback with the expired page', async () => {
    await setUp();
    const forged = await t.app.inject({
      method: 'GET',
      url: '/api/connectors/mcp/oauth/callback?state=x&code=y',
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.body).toContain('Sign-in link expired');
    const start = (await connect('test-lejar')).json() as ConnectorConnectResult;
    const state = new URL(start.authorizationUrl!).searchParams.get('state')!;
    const noCode = await t.app.inject({
      method: 'GET',
      url: `/api/connectors/mcp/oauth/callback?state=${state}`,
    });
    expect(noCode.statusCode).toBe(400);
    expect((await api('GET', `/test-lejar/connect/${start.requestId}`)).json()).toEqual({
      status: 'failed',
      problem: 'refused',
    });
  });

  it('uses the public client ID an entry carries', async () => {
    await setUp();
    const lejar = entries[0]!;
    lejar.auth = { type: 'oauth', clientId: PARTNER_CREDENTIALS.publicClientId, scopes: [] };
    const { start, page } = await signIn('test-lejar');
    expect(new URL(start.authorizationUrl!).searchParams.get('client_id')).toBe(
      PARTNER_CREDENTIALS.publicClientId,
    );
    expect(page.statusCode, page.body).toBe(200);
  });

  it("signs in with the admin's own app (client ID and secret)", async () => {
    await setUp();
    expect(
      (await connect('test-bayar', { clientId: PARTNER_CREDENTIALS.clientId })).statusCode,
    ).toBe(400);
    const wrong = await signIn('test-bayar', {
      clientId: PARTNER_CREDENTIALS.clientId,
      clientSecret: 'wrong',
    });
    expect(wrong.page.statusCode).toBe(400);
    expect((await api('GET', `/test-bayar/connect/${wrong.start.requestId}`)).json()).toEqual({
      status: 'failed',
      problem: 'refused',
    });
    const right = await signIn('test-bayar', {
      clientId: PARTNER_CREDENTIALS.clientId,
      clientSecret: PARTNER_CREDENTIALS.clientSecret,
    });
    expect(right.page.statusCode, right.page.body).toBe(200);
    expect((await api('POST', '/test-bayar/test')).json()).toMatchObject({ ok: true });
  });

  it('fails the sign-in when the partner lacks a listed tool', async () => {
    await setUp();
    const lejar = entries[0]!;
    lejar.tools = [...lejar.tools!, { ...lejar.tools![0]!, name: 'ghost_tool' }];
    const { start, page } = await signIn('test-lejar');
    expect(page.statusCode).toBe(400);
    expect((await api('GET', `/test-lejar/connect/${start.requestId}`)).json()).toEqual({
      status: 'failed',
      problem: 'missing_tools',
    });
  });

  it('refuses a sign-in the partner cannot start', async () => {
    await setUp();
    kit.setState('oauth', 'down');
    try {
      const res = await connect('test-lejar');
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe('unreachable');
    } finally {
      kit.setState('oauth', 'ok');
    }
    const bayar = await connect('test-bayar', { clientId: 'x', clientSecret: 'y' });
    expect(bayar.statusCode, bayar.body).toBe(200); // the partner checks the client only at the token step
  });
});

describe('disconnect, settings, activity and choices', () => {
  it('revokes the grant, deletes the secret, keeps settings and activity', async () => {
    await setUp();
    await signIn('test-lejar');
    const agentId = makeAgent();
    expect(
      (await api('PUT', `/test-lejar/agents/${agentId}`, { tools: { create_quotation: true } }))
        .statusCode,
    ).toBe(200);
    svc().addActivity({
      connectorId: 'test-lejar',
      kind: 'checked',
      agentId,
      chatJid: null,
      tool: 'find_invoice',
    });
    const revokedBefore = kit.oauth.oauth.revoked;
    const res = await api('POST', '/test-lejar/disconnect');
    expect(res.json()).toEqual({
      state: 'disconnected',
      account: null,
      keyEnd: null,
      connectedAt: null,
      fields: {},
    });
    expect(kit.oauth.oauth.revoked).toBe(revokedBefore + 1);
    expect(t.ctx.db.prepare('SELECT secret FROM connector_connections').get()).toEqual({
      secret: null,
    });
    expect(svc().port.saved()).toEqual([]);
    expect((await api('GET', `/test-lejar/agents/${agentId}`)).json().tools.create_quotation).toBe(
      true,
    );
    expect((await api('GET', '/test-lejar/activity')).json().activity).toHaveLength(1);
    expect((await api('POST', '/test-lejar/test')).statusCode).toBe(404);
    expect(auditActions()).toContain('connector.disconnect');
  });

  it('gives defaults, validates every setting type and the tool switches, and audits changes', async () => {
    await setUp();
    const agentId = makeAgent();
    expect((await api('GET', '/test-kedai/agents/999')).statusCode).toBe(404);
    expect((await api('GET', `/test-kedai/agents/${agentId}`)).json()).toEqual({
      settings: {
        hours: ['09:00', '18:00'],
        days: [1, 2, 3, 4, 5],
        currency: 'MYR',
        discounts: false,
      },
      tools: {
        find_invoice: true,
        check_stock: true,
        list_price_lists: true,
        create_quotation: false,
      },
    });
    const bad: object[] = [
      { settings: { unknown: 1 } },
      { tools: { delete_invoice: true } },
      { settings: { hours: ['18:00', '09:00'] } },
      { settings: { hours: ['9:00', '18:00'] } },
      { settings: { days: [1, 1] } },
      { settings: { days: [7] } },
      { settings: { currency: 'USD' } },
      { settings: { discounts: 'yes' } },
      { settings: { note: 5 } },
      { settings: { priceList: 'x'.repeat(301) } },
      { tools: { find_invoice: 'on' } },
    ];
    for (const body of bad)
      expect(
        (await api('PUT', `/test-kedai/agents/${agentId}`, body)).statusCode,
        JSON.stringify(body),
      ).toBe(400);
    const kedai = entries[1]!;
    kedai.settings = [
      ...kedai.settings!,
      { id: 'branch', type: 'text', label: { en: 'Branch' }, required: true },
      { id: 'limit', type: 'number', label: { en: 'Limit' } },
    ];
    expect(
      (await api('PUT', `/test-kedai/agents/${agentId}`, { tools: { find_invoice: true } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await api('PUT', `/test-kedai/agents/${agentId}`, { settings: { limit: 'x' } })).statusCode,
    ).toBe(400);
    const ok = await api('PUT', `/test-kedai/agents/${agentId}`, {
      settings: { branch: ' KL ', days: [5, 1], note: 'Be brief', limit: 3, currency: null },
      tools: { create_quotation: true },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({
      settings: {
        hours: ['09:00', '18:00'],
        days: [1, 5],
        currency: 'MYR',
        discounts: false,
        branch: 'KL',
        note: 'Be brief',
        limit: 3,
      },
      tools: {
        find_invoice: true,
        check_stock: true,
        list_price_lists: true,
        create_quotation: true,
      },
    });
    const meta = JSON.parse(
      (
        t.ctx.db
          .prepare("SELECT meta FROM audit_log WHERE action = 'connector.agent_settings'")
          .get() as { meta: string }
      ).meta,
    );
    expect(meta).toEqual({
      connectorId: 'test-kedai',
      agentId,
      fields: ['days', 'branch', 'note', 'limit'],
      tools: ['create_quotation'],
    });
  });

  it('lists choices from the read tool a picker names', async () => {
    await setUp();
    await connect('test-kedai', { key: PARTNER_CREDENTIALS.apiKey });
    expect((await api('GET', '/test-kedai/choices/priceList?agentId=1')).json()).toEqual({
      options: [
        { value: 'retail', label: 'Retail' },
        { value: 'wholesale', label: 'Wholesale' },
      ],
    });
    expect((await api('GET', '/test-kedai/choices/hours')).statusCode).toBe(404);
    kit.setState('api-key', 'rpc_error');
    try {
      const failed = await api('GET', '/test-kedai/choices/priceList');
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe('unreachable');
    } finally {
      kit.setState('api-key', 'ok');
    }
    kit.setState('api-key', 'down');
    try {
      expect((await api('GET', '/test-kedai/choices/priceList')).json().error.code).toBe(
        'unreachable',
      );
    } finally {
      kit.setState('api-key', 'ok');
    }
  });

  it('keeps working with the saved entry after the list drops it, and follows list updates otherwise', async () => {
    await setUp();
    await connect('test-kedai', { key: PARTNER_CREDENTIALS.apiKey });
    const agentId = makeAgent();
    entries[1] = { ...entries[1]!, name: 'Kedai CRM v2' };
    expect(svc().turnConnectors(agentId)[0]!.entry.name).toBe('Kedai CRM v2');
    entries[1] = { ...entries[1], mcp: { url: 'https://elsewhere.example.com/mcp' } };
    expect(svc().turnConnectors(agentId)[0]!.entry.name).toBe('Kedai CRM (test)');
    entries.splice(1, 1);
    expect(
      svc()
        .port.saved()
        .map((s) => s.id),
    ).toEqual(['test-kedai']);
    expect((await api('GET', `/test-kedai/agents/${agentId}`)).statusCode).toBe(200);
    expect((await api('POST', '/test-kedai/test')).json()).toMatchObject({ ok: true });
    expect(svc().lookupsAvailable(agentId)).toBe(true);
    expect(svc().lookupsAvailable(null)).toBe(false);
    expect(svc().turnConnectors(999)).toEqual([]);
  });
});

describe('test connector list', () => {
  const get = (url: string) =>
    new Promise<Buffer>((resolve, reject) => {
      request(url, { ca: kit.cert }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
        .on('error', reject)
        .end();
    });

  it('serves a signed list of the test partners that the list module accepts', async () => {
    const bytes = await get(kit.listUrl);
    const sig = await get(`${kit.listUrl}.sig`);
    expect(signatureValid(bytes, sig, publicKeys([kit.listPublicKey]))).toBe(true);
    expect(
      signatureValid(
        Buffer.concat([bytes, Buffer.from(' ')]),
        sig,
        publicKeys([kit.listPublicKey]),
      ),
    ).toBe(false);
    const list = JSON.parse(bytes.toString('utf8')) as { format: number; entries: unknown[] };
    const parsed = parseEntries(list.entries);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.entries.map((e) => [e.id, e.kind, e.auth?.type ?? null])).toEqual([
      ['google-calendar', 'builtin', null],
      ['test-lejar', 'mcp', 'oauth'],
      ['test-kedai', 'mcp', 'api_key'],
      ['test-gudang', 'mcp', 'credentials'],
      ['test-bayar', 'mcp', 'oauth_own_app'],
      ['test-open', 'mcp', 'none'],
    ]);
    for (const entry of parsed.entries.filter((e) => e.icon)) {
      const icon = await get(`${kit.listBaseUrl}icons/${entry.icon!.file}`);
      expect(sha256(icon)).toBe(entry.icon!.sha256);
      expect(iconContentOk(entry.icon!.file, icon)).toBe(true);
    }
    expect((await get(`${kit.listBaseUrl}icons/nope.svg`)).toString()).toContain('not_found');
  });
});

function makeAgent(): number {
  const ai = t.ctx.services.ai!;
  const actor = { userId: 1, ip: null };
  ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  ai.saveMember({ displayName: 'Aina', enabled: false, instructions: '' }, actor);
  return listAgents(t.ctx.db)[0]!.id;
}

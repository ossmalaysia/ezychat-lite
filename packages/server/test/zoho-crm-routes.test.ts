import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ZOHO_CRM_SETTINGS, ZohoCrmStatus } from '@ezychat/shared';
import { listAgents } from '../src/ai/agents.js';
import { createZohoCrmService, TOKENS_SETTING } from '../src/connectors/zoho-crm/service.js';
import { FakeZoho } from '../src/connectors/zoho-crm/fake.js';
import { addActivity } from '../src/connectors/zoho-crm/repo.js';
import { getMessages } from '../src/wa-bridge/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

const JASON = '60129001234@s.whatsapp.net';
const NEW = '60132228899@s.whatsapp.net';

async function setUp(options: Parameters<typeof makeTestApp>[0] = {}) {
  t = await makeTestApp(options);
  const admin = await createUserAndLogin(t, { role: 'admin' });
  const agent = await createUserAndLogin(t, { role: 'agent' });
  t.ctx.services.ai!.saveMember(
    { displayName: 'Aina', enabled: false, instructions: '' },
    { userId: admin.user.id, ip: null },
  );
  return {
    admin: admin.cookie,
    agent: agent.cookie,
    adminId: admin.user.id,
    agentId: listAgents(t.ctx.db)[0]!.id,
  };
}

const get = (url: string, cookie: string) =>
  t.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie: string, payload: unknown = {}) =>
  t.app.inject({ method: 'POST', url, headers: authHeaders(cookie), payload: payload as object });
const put = (url: string, cookie: string, payload: unknown) =>
  t.app.inject({ method: 'PUT', url, headers: authHeaders(cookie), payload: payload as object });

/** The whole sign-in on the fake: connect, the consent page's Accept (or Cancel), Zoho's redirect. */
async function connect(cookie: string, choice: 'accept' | 'cancel' = 'accept', region = 'com') {
  const start = await post('/api/connectors/zoho-crm/connect', cookie, { region });
  expect(start.statusCode).toBe(200);
  const { requestId, authorizationUrl } = start.json() as {
    requestId: string;
    authorizationUrl: string;
  };
  const consentUrl = new URL(authorizationUrl);
  expect(consentUrl.pathname).toBe('/api/dev/fake-zoho/consent');
  const consent = await t.app.inject({
    method: 'GET',
    url: consentUrl.pathname + consentUrl.search,
  });
  expect(consent.statusCode).toBe(200);
  const href = new RegExp(`id="${choice}" href="([^"]+)"`)
    .exec(consent.body)![1]!
    .replaceAll('&#38;', '&');
  const target = new URL(href);
  expect(target.pathname).toBe('/api/connectors/zoho-crm/callback');
  const callback = await t.app.inject({ method: 'GET', url: target.pathname + target.search });
  return { requestId, callback, target, consentUrl };
}

async function customer(chatJid: string, name: string, text = 'Hello') {
  await getMessages(t.ctx).ingest(
    {
      id: `in-${chatJid}-${text.length}`,
      chatJid,
      body: text,
      type: 'text',
      fromMe: false,
      senderJid: chatJid,
      senderName: name,
      timestamp: Date.now(),
      quotedId: null,
      media: null,
    },
    'live',
  );
}

describe('Zoho CRM routes', () => {
  it('admin routes are admin only; chat routes need a signed-in user', async () => {
    const { agent, agentId } = await setUp();
    const adminOnly = [
      ['GET', '/api/connectors/zoho-crm'],
      ['POST', '/api/connectors/zoho-crm/connect'],
      ['GET', '/api/connectors/zoho-crm/connect/0123456789abcdef01234567'],
      ['POST', '/api/connectors/zoho-crm/disconnect'],
      ['GET', `/api/connectors/zoho-crm/agents/${agentId}`],
      ['PUT', `/api/connectors/zoho-crm/agents/${agentId}`],
      ['GET', '/api/connectors/zoho-crm/activity'],
      ['POST', '/api/dev/fake-zoho'],
      ['GET', '/api/dev/fake-zoho'],
    ] as const;
    for (const [method, url] of adminOnly) {
      const anonymous = await t.app.inject({
        method,
        url,
        headers: { origin: 'http://localhost', host: 'localhost' },
        payload: method === 'GET' ? undefined : {},
      });
      expect(anonymous.statusCode, url).toBe(401);
      const asAgent = await t.app.inject({
        method,
        url,
        headers: authHeaders(agent),
        payload: method === 'GET' ? undefined : {},
      });
      expect(asAgent.statusCode, url).toBe(403);
    }
    const anonymous = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${encodeURIComponent(JASON)}/zoho-crm`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('connects through the fake Zoho in the chosen data centre and shows the organisation', async () => {
    const { admin } = await setUp();
    const before = ZohoCrmStatus.parse((await get('/api/connectors/zoho-crm', admin)).json());
    expect(before).toEqual({
      state: 'disconnected',
      region: null,
      account: null,
      org: null,
      users: [],
      crmUrl: null,
      connectedAt: null,
      problemSince: null,
    });
    const bad = await post('/api/connectors/zoho-crm/connect', admin, { region: 'cn' });
    expect(bad.statusCode).toBe(400);
    const { requestId, callback, target } = await connect(admin, 'accept', 'eu');
    expect(target.searchParams.get('accounts-server')).toBe('https://accounts.fake-zoho.invalid');
    expect(callback.statusCode).toBe(200);
    expect(callback.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(callback.body).toContain('Zoho CRM connected');
    expect((await get(`/api/connectors/zoho-crm/connect/${requestId}`, admin)).json()).toEqual({
      status: 'done',
      error: null,
    });
    const status = ZohoCrmStatus.parse((await get('/api/connectors/zoho-crm', admin)).json());
    expect(status).toMatchObject({
      state: 'connected',
      region: 'eu',
      account: 'demo.crm@example.com',
      org: 'Demo Trading Sdn Bhd',
      crmUrl: 'https://crm.zoho.eu/crm/org700123456/',
      problemSince: null,
    });
    expect(status.users.map((u) => u.name)).toEqual(['Demo Owner', 'Sales Rep']);
    // tokens only in the encrypted setting, never in the answer
    expect(JSON.stringify(status)).not.toContain('fake-zoho-');
    expect(t.ctx.settings.getSecret(TOKENS_SETTING)).toContain('fake-zoho-refresh-');
    // the same callback again changes nothing
    const replay = await t.app.inject({ method: 'GET', url: target.pathname + target.search });
    expect(replay.statusCode).toBe(400);
    expect(replay.body).toContain('Sign-in link expired');
    const audit = t.ctx.db
      .prepare("SELECT action, meta FROM audit_log WHERE action LIKE 'zoho_crm.%'")
      .all();
    expect(audit).toEqual([{ action: 'zoho_crm.connect', meta: JSON.stringify({ region: 'eu' }) }]);
  });

  it('records a cancelled sign-in, refuses a callback from another computer and unknown requests', async () => {
    const { admin } = await setUp();
    const { requestId, callback } = await connect(admin, 'cancel');
    expect(callback.statusCode).toBe(400);
    expect(callback.body).toContain('Sign-in cancelled');
    expect((await get(`/api/connectors/zoho-crm/connect/${requestId}`, admin)).json()).toEqual({
      status: 'failed',
      error: 'denied',
    });
    const tunnel = await t.app.inject({
      method: 'GET',
      url: '/api/connectors/zoho-crm/callback?state=x&code=y',
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(tunnel.statusCode).toBe(403);
    const unknown = await get('/api/connectors/zoho-crm/connect/0123456789abcdef01234567', admin);
    expect(unknown.statusCode).toBe(404);
    // a callback naming an accounts server that is not Zoho's never exchanges the code
    const start = await post('/api/connectors/zoho-crm/connect', admin, { region: 'com' });
    const state = new URL(start.json().authorizationUrl).searchParams.get('state')!;
    const evil = await t.app.inject({
      method: 'GET',
      url: `/api/connectors/zoho-crm/callback?state=${state}&code=abc&accounts-server=${encodeURIComponent('https://evil.example')}`,
    });
    expect(evil.statusCode).toBe(400);
    expect(t.ctx.settings.getSecret(TOKENS_SETTING)).toBeNull();
  });

  it('saves per-agent settings, checks the lead owner and audits changed fields', async () => {
    const { admin, agentId } = await setUp();
    const url = `/api/connectors/zoho-crm/agents/${agentId}`;
    expect((await get(url, admin)).json()).toEqual(DEFAULT_ZOHO_CRM_SETTINGS);
    expect((await get('/api/connectors/zoho-crm/agents/999', admin)).statusCode).toBe(404);
    const needsFind = await put(url, admin, {
      ...DEFAULT_ZOHO_CRM_SETTINGS,
      find: false,
      addLeads: true,
    });
    expect(needsFind.statusCode).toBe(400);
    await connect(admin);
    const unknownOwner = await put(url, admin, { ...DEFAULT_ZOHO_CRM_SETTINGS, ownerId: '999' });
    expect(unknownOwner.statusCode).toBe(400);
    const saved = await put(url, admin, {
      ...DEFAULT_ZOHO_CRM_SETTINGS,
      addLeads: true,
      ownerId: '4150868000000225021',
      leadSource: ' WhatsApp Lite ',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ addLeads: true, leadSource: 'WhatsApp Lite' });
    expect((await get(url, admin)).json()).toMatchObject({ ownerId: '4150868000000225021' });
    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'zoho_crm.agent_settings'")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta)).toEqual({
      agentId,
      fields: ['addLeads', 'ownerId', 'leadSource'],
    });
    // Zoho unreachable while choosing an owner: 503, nothing saved
    await post('/api/dev/fake-zoho', admin, { state: 'unavailable' });
    const down = await put(url, admin, {
      ...DEFAULT_ZOHO_CRM_SETTINGS,
      ownerId: '4150868000000225013',
    });
    expect(down.statusCode).toBe(503);
  });

  it('shows the chat record to teammates, adds a lead from the chat, and lists the activity', async () => {
    const { admin, agent, adminId } = await setUp();
    await customer(JASON, 'Jason');
    // not connected: the card is hidden
    expect((await get(`/api/chats/${encodeURIComponent(JASON)}/zoho-crm`, agent)).json()).toEqual({
      state: 'disconnected',
      record: null,
    });
    await connect(admin);
    const jason = await get(`/api/chats/${encodeURIComponent(JASON)}/zoho-crm`, agent);
    expect(jason.json()).toEqual({
      state: 'connected',
      record: {
        module: 'Leads',
        id: '4150868000000498003',
        name: 'Jason Lim',
        company: 'Lim Trading',
        owner: 'Demo Owner',
        status: 'Contacted',
        addedBy: null,
        request: null,
        url: 'https://crm.zoho.com/crm/org700123456/tab/Leads/4150868000000498003',
      },
    });
    // already in Zoho CRM: 409
    const exists = await post(`/api/chats/${encodeURIComponent(JASON)}/zoho-crm/lead`, agent);
    expect(exists.statusCode).toBe(409);
    expect(exists.json().error.code).toBe('exists');
    // a chat named after its number has no name yet
    await customer(NEW, '');
    const noName = await post(`/api/chats/${encodeURIComponent(NEW)}/zoho-crm/lead`, agent);
    expect(noName.statusCode).toBe(409);
    expect(noName.json().error.code).toBe('no_name');
    t.ctx.services.customers!.save(
      NEW,
      {
        name: 'Kavitha Menon',
        company: 'Bright Dental',
        email: 'k@example.com',
        otherPhone: '',
        address: '',
        tags: [],
      },
      { userId: adminId, ip: null },
    );
    const added = await post(`/api/chats/${encodeURIComponent(NEW)}/zoho-crm/lead`, agent);
    expect(added.statusCode).toBe(200);
    expect(added.json().record).toMatchObject({
      module: 'Leads',
      name: 'Kavitha Menon',
      company: 'Bright Dental',
      addedBy: 'team',
    });
    const lead = t.ctx.services.zohoCrm!.fake!.records.at(-1)!;
    expect(lead).toMatchObject({
      firstName: 'Kavitha',
      lastName: 'Menon',
      email: 'k@example.com',
      leadSource: 'WhatsApp',
    });
    expect(
      t.ctx.db.prepare("SELECT action FROM audit_log WHERE action = 'zoho_crm.lead_add'").all(),
    ).toHaveLength(1);
    const activity = (await get('/api/connectors/zoho-crm/activity', admin)).json().activity;
    expect(activity[0]).toMatchObject({
      kind: 'added_by_team',
      customer: 'Kavitha Menon',
      module: 'Leads',
    });
    expect(activity[0].actorName).not.toBe('');
    // Zoho down: the card says unavailable, adding answers 503
    await post('/api/dev/fake-zoho', admin, { state: 'unavailable' });
    await customer('60125550142@s.whatsapp.net', 'Ahmad');
    const down = await post(
      `/api/chats/${encodeURIComponent('60125550142@s.whatsapp.net')}/zoho-crm/lead`,
      agent,
    );
    expect(down.statusCode).toBe(503);
    // an unknown chat is 404
    expect(
      (await get(`/api/chats/${encodeURIComponent('60100000000@s.whatsapp.net')}/zoho-crm`, agent))
        .statusCode,
    ).toBe(404);
  });

  it('shows expired and unavailable, refreshes an expired access token, and disconnects', async () => {
    const { admin } = await setUp();
    await connect(admin);
    const fake = t.ctx.services.zohoCrm!.fake!;
    // an access token Zoho no longer accepts is refreshed once, silently
    fake.expireAccessTokens();
    await customer(JASON, 'Jason');
    const record = await get(`/api/chats/${encodeURIComponent(JASON)}/zoho-crm`, admin);
    expect(record.json().record?.name).toBe('Jason Lim');
    expect(fake.calls).toContain('token refresh_token');
    const expired = await post('/api/dev/fake-zoho', admin, { state: 'expired' });
    expect(expired.json()).toMatchObject({ state: 'expired', problemSince: expect.any(Number) });
    // a working call ends the problem (Zoho accepted the sign-in again)
    const ok = await post('/api/dev/fake-zoho', admin, { state: 'ok' });
    expect(ok.json()).toMatchObject({ state: 'connected', problemSince: null });
    // signing in again also works while it is expired
    await post('/api/dev/fake-zoho', admin, { state: 'expired' });
    fake.mode = 'ok';
    await connect(admin);
    expect((await get('/api/connectors/zoho-crm', admin)).json().state).toBe('connected');
    expect((await get('/api/dev/fake-zoho', admin)).json()).toEqual({ mode: 'ok', leads: 1 });
    const off = await post('/api/connectors/zoho-crm/disconnect', admin);
    expect(off.json().state).toBe('disconnected');
    expect(fake.calls).toContain('revoke');
    expect(t.ctx.settings.getSecret(TOKENS_SETTING)).toBeNull();
  });

  it('is not configured without a Zoho app (no fake), and names activity actors', async () => {
    const { admin, agentId } = await setUp({
      beforeBuild: (ctx) => {
        ctx.services.zohoCrm = createZohoCrmService(ctx, { client: null, fake: null });
      },
    });
    expect((await get('/api/connectors/zoho-crm', admin)).json().state).toBe('not_configured');
    const start = await post('/api/connectors/zoho-crm/connect', admin, { region: 'com' });
    expect(start.statusCode).toBe(409);
    expect(start.json().error.code).toBe('not_configured');
    addActivity(t.ctx.db, { kind: 'not_added', agentId, chatJid: null, reason: 'no_name' }, 5);
    expect((await get('/api/connectors/zoho-crm/activity', admin)).json().activity).toEqual([
      {
        id: expect.any(Number),
        at: 5,
        kind: 'not_added',
        agentId,
        actorName: 'Aina',
        chatJid: null,
        customer: '',
        module: null,
        reason: 'no_name',
      },
    ]);
  });

  it('uses a fresh fake per service', () => {
    expect(new FakeZoho().records).toHaveLength(2);
  });
});

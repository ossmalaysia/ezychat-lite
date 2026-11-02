import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SHEETS_SETTINGS } from '@ezychat/shared';
import { listAgents } from '../src/ai/agents.js';
import { FAKE_SPREADSHEET_ID } from '../src/connectors/google-sheets/fake.js';
import { TOKENS_SETTING } from '../src/connectors/google-sheets/service.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import {
  SHEETS_PATHS,
  connectThroughFake,
  expectAdminOnly,
  expectCallbackHostOnly,
} from './google-connector-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

const LINK = `https://docs.google.com/spreadsheets/d/${FAKE_SPREADSHEET_ID}/edit#gid=0`;

async function setUp() {
  t = await makeTestApp();
  const admin = await createUserAndLogin(t, { role: 'admin' });
  const agent = await createUserAndLogin(t, { role: 'agent' });
  t.ctx.services.ai!.saveMember(
    { displayName: 'Aina', enabled: false, instructions: '' },
    { userId: admin.user.id, ip: null },
  );
  return { admin: admin.cookie, agent: agent.cookie, agentId: listAgents(t.ctx.db)[0]!.id };
}

const get = (url: string, cookie: string) =>
  t.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie: string, payload: unknown = {}) =>
  t.app.inject({ method: 'POST', url, headers: authHeaders(cookie), payload: payload as object });
const put = (url: string, cookie: string, payload: unknown) =>
  t.app.inject({ method: 'PUT', url, headers: authHeaders(cookie), payload: payload as object });

const connect = (cookie: string, choice: 'allow' | 'cancel' = 'allow') =>
  connectThroughFake(t, SHEETS_PATHS, cookie, choice);

describe('Google Sheets routes', () => {
  it('are admin only', async () => {
    const { agent, agentId } = await setUp();
    await expectAdminOnly(t, agent, [
      ['GET', '/api/connectors/google-sheets'],
      ['POST', '/api/connectors/google-sheets/connect'],
      ['GET', '/api/connectors/google-sheets/connect/0123456789abcdef01234567'],
      ['POST', '/api/connectors/google-sheets/disconnect'],
      ['POST', '/api/connectors/google-sheets/spreadsheet'],
      ['GET', `/api/connectors/google-sheets/agents/${agentId}`],
      ['PUT', `/api/connectors/google-sheets/agents/${agentId}`],
      ['GET', '/api/connectors/google-sheets/activity'],
      ['GET', '/api/dev/fake-google-sheets'],
      ['POST', '/api/dev/fake-google-sheets'],
    ]);
  });

  it('connects through the fake Google, keeps tokens encrypted and disconnects', async () => {
    const { admin } = await setUp();
    expect((await get('/api/connectors/google-sheets', admin)).json()).toEqual({
      state: 'disconnected',
      account: null,
      connectedAt: null,
      problemSince: null,
    });
    const { requestId, callback } = await connect(admin);
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain('Google Sheets connected');
    expect(callback.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect((await get(`/api/connectors/google-sheets/connect/${requestId}`, admin)).json()).toEqual(
      { status: 'done', error: null },
    );
    const status = (await get('/api/connectors/google-sheets', admin)).json();
    expect(status).toMatchObject({ state: 'connected', account: 'demo.sheets@example.com' });
    const raw = t.ctx.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(TOKENS_SETTING) as { value: string };
    expect(raw.value).not.toContain('fake-refresh');
    // Google Calendar keeps its own sign-in.
    expect((await get('/api/connectors/google-calendar', admin)).json().state).toBe('disconnected');

    const out = await post('/api/connectors/google-sheets/disconnect', admin);
    expect(out.json().state).toBe('disconnected');
    expect(t.ctx.services.googleSheets!.fake!.calls).toContain('revoke');
    const actions = (
      t.ctx.db
        .prepare("SELECT action FROM audit_log WHERE action LIKE 'google_sheets.%' ORDER BY id")
        .all() as Array<{ action: string }>
    ).map((r) => r.action);
    expect(actions).toEqual(['google_sheets.connect', 'google_sheets.disconnect']);
  });

  it('records Cancel, refuses a sign-in without the Sheets permission and stale callbacks', async () => {
    const { admin } = await setUp();
    const cancelled = await connect(admin, 'cancel');
    expect(cancelled.callback.statusCode).toBe(400);
    expect(
      (await get(`/api/connectors/google-sheets/connect/${cancelled.requestId}`, admin)).json(),
    ).toEqual({ status: 'failed', error: 'denied' });

    const start = (await post('/api/connectors/google-sheets/connect', admin)).json() as {
      authorizationUrl: string;
    };
    const state = new URL(start.authorizationUrl).searchParams.get('state')!;
    const fake = t.ctx.services.googleSheets!.fake!;
    // No PKCE challenge of this sign-in: Google (the fake) refuses the exchange.
    const wrong = fake.issueCode('other', 'openid');
    const bad = await t.app.inject({
      method: 'GET',
      url: `/api/connectors/google-sheets/callback?state=${state}&code=${wrong}`,
    });
    expect(bad.statusCode).toBe(400);
    const reused = await t.app.inject({
      method: 'GET',
      url: `/api/connectors/google-sheets/callback?state=${state}&code=${wrong}`,
    });
    expect(reused.body).toContain('Sign-in link expired');

    // A consent where the person unticked the Sheets permission: refused and revoked.
    const second = (await post('/api/connectors/google-sheets/connect', admin)).json() as {
      authorizationUrl: string;
    };
    const url = new URL(second.authorizationUrl);
    const code = fake.issueCode(url.searchParams.get('code_challenge')!, 'openid email');
    const unticked = await t.app.inject({
      method: 'GET',
      url: `/api/connectors/google-sheets/callback?state=${url.searchParams.get('state')}&code=${code}`,
    });
    expect(unticked.statusCode).toBe(400);
    expect(unticked.body).toContain('Google Sheets access was not allowed');
    expect(fake.calls).toContain('revoke');
    expect((await get('/api/connectors/google-sheets', admin)).json().state).toBe('disconnected');
  });

  it('answers the callback only on this computer', async () => {
    const { admin } = await setUp();
    const start = (await post('/api/connectors/google-sheets/connect', admin)).json() as {
      authorizationUrl: string;
    };
    const state = new URL(start.authorizationUrl).searchParams.get('state')!;
    await expectCallbackHostOnly(t, `/api/connectors/google-sheets/callback?state=${state}&code=x`);
  });

  it('finds a spreadsheet from its link and saves per-agent settings checked with Google', async () => {
    const { admin, agentId } = await setUp();
    const url = `/api/connectors/google-sheets/agents/${agentId}`;
    expect((await get(url, admin)).json()).toEqual(DEFAULT_SHEETS_SETTINGS);
    // Not connected yet.
    expect(
      (await post('/api/connectors/google-sheets/spreadsheet', admin, { link: LINK })).statusCode,
    ).toBe(409);
    await connect(admin);

    const info = await post('/api/connectors/google-sheets/spreadsheet', admin, { link: LINK });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toEqual({
      id: FAKE_SPREADSHEET_ID,
      name: 'Demo price list',
      tabs: [
        { title: 'Prices', rows: 1000 },
        { title: 'Leads', rows: 1000 },
      ],
      url: `https://docs.google.com/spreadsheets/d/${FAKE_SPREADSHEET_ID}/edit`,
    });
    const notALink = await post('/api/connectors/google-sheets/spreadsheet', admin, {
      link: 'https://example.com/x',
    });
    expect(notALink.statusCode).toBe(400);
    const unknown = await post('/api/connectors/google-sheets/spreadsheet', admin, {
      link: 'unknown-sheet-00000000000000000000',
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toContain('cannot open this spreadsheet');

    const base = {
      ...DEFAULT_SHEETS_SETTINGS,
      spreadsheetId: FAKE_SPREADSHEET_ID,
      lookupTab: 'Prices',
    };
    // A tab the sheet does not have, and add-leads without a tab.
    expect((await put(url, admin, { ...base, lookupTab: 'Nope' })).statusCode).toBe(400);
    expect((await put(url, admin, { ...base, addLeads: true })).statusCode).toBe(400);
    const saved = await put(url, admin, { ...base, addLeads: true, leadsTab: 'Leads' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ spreadsheetName: 'Demo price list', addLeads: true });
    expect((await get(url, admin)).json()).toMatchObject({
      leadsTab: 'Leads',
      lookupTab: 'Prices',
    });
    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'google_sheets.agent_settings'")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta).fields).toEqual([
      'spreadsheetId',
      'lookupTab',
      'leadsTab',
      'addLeads',
    ]);

    // Clearing the spreadsheet clears the tabs and turns adding leads off.
    const cleared = await put(url, admin, { ...(saved.json() as object), spreadsheetId: null });
    expect(cleared.json()).toMatchObject({ lookupTab: null, leadsTab: null, addLeads: false });
    expect((await get('/api/connectors/google-sheets/agents/999', admin)).statusCode).toBe(404);
  });

  it('shows Google problems as states and recovers', async () => {
    const { admin } = await setUp();
    await connect(admin);
    const fake = t.ctx.services.googleSheets!.fake!;
    await post('/api/dev/fake-google-sheets', admin, { state: 'unavailable' });
    expect(
      (await post('/api/connectors/google-sheets/spreadsheet', admin, { link: LINK })).statusCode,
    ).toBe(503);
    expect((await get('/api/connectors/google-sheets', admin)).json()).toMatchObject({
      state: 'unavailable',
    });
    fake.mode = 'expired';
    fake.expireAccessTokens();
    await post('/api/connectors/google-sheets/spreadsheet', admin, { link: LINK });
    const expired = (await get('/api/connectors/google-sheets', admin)).json();
    expect(expired.state).toBe('expired');
    expect(expired.problemSince).toEqual(expect.any(Number));
    fake.mode = 'ok';
    await connect(admin);
    expect((await get('/api/connectors/google-sheets', admin)).json().state).toBe('connected');
    const dev = (await get('/api/dev/fake-google-sheets', admin)).json();
    expect(dev.sheets[0].tabs.Prices[0]).toEqual(['Item', 'Price (RM)', 'In stock', 'Notes']);
  });
});

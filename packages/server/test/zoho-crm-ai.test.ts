import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ZOHO_CRM_SETTINGS, type ZohoCrmAgentSettings } from '@ezychat/shared';
import type { ToolSet } from 'ai';
import pino from 'pino';
import { listAgents } from '../src/ai/agents.js';
import { agentLookupsAvailable, agentTurnTools } from '../src/ai/agent/turn-tools.js';
import { createAiService, AI_FALLBACK_MS } from '../src/ai/service.js';
import type { AiPrompt, AiProvider } from '../src/ai/provider-types.js';
import { mergeChat } from '../src/chats/merge.js';
import type { AppContext } from '../src/context.js';
import { createMessageService } from '../src/messages/service.js';
import { zohoAgentTools } from '../src/connectors/zoho-crm/tools.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

const jid = '60132228899@s.whatsapp.net';
const FARAH = '60123110021@s.whatsapp.net';

type Decision = { reply: string; action: 'answer' | 'handoff'; handoffReason?: string | null };
type Script = (tools: ToolSet, signal: AbortSignal) => Promise<Decision>;

let t: TestApp;
let provider: AiProvider;
let script: Script;
let adminId: number;
let agentId: number;

async function call(tools: ToolSet, name: string, input: object, signal: AbortSignal) {
  const execute = tools[name]?.execute as
    ((input: object, options: object) => Promise<string>) | undefined;
  if (!execute) throw new Error(`tool ${name} not offered`);
  return execute(input, { toolCallId: `call-${name}`, messages: [], abortSignal: signal });
}

async function connectZoho(ctx: AppContext) {
  const svc = ctx.services.zohoCrm!;
  const start = svc.startConnect('com', 'http://127.0.0.1:7420/api/connectors/zoho-crm/callback', {
    userId: adminId,
    ip: null,
  });
  const state = new URL(start.authorizationUrl).searchParams.get('state')!;
  const target = new URL(svc.fakeConsent(state, true)!);
  const page = await svc.callback(Object.fromEntries(target.searchParams));
  expect(page.status).toBe(200);
}

const saveSettings = (patch: Partial<ZohoCrmAgentSettings> = {}) =>
  t.ctx.services.zohoCrm!.putSettings(
    agentId,
    { ...DEFAULT_ZOHO_CRM_SETTINGS, ...patch },
    { userId: adminId, ip: null },
  );

async function setUp({ connect = true, settings = {} as Partial<ZohoCrmAgentSettings> } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-29T02:00:00Z'));
  provider = {
    generate: vi.fn(async (_s, _k, prompt: AiPrompt, signal: AbortSignal) =>
      script(prompt.tools ?? {}, signal),
    ) as AiProvider['generate'],
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.messages!.shutdown();
      ctx.services.messages = createMessageService(ctx, {
        now: () => Date.now(),
        queue: { spacingMs: 0 },
      });
      ctx.services.ai = createAiService(ctx, { provider, isOnline: () => true });
    },
  });
  const admin = t.ctx.services.auth!.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  adminId = admin.id;
  const actor = { userId: adminId, ip: null };
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  ai.saveMember({ displayName: 'Aina', enabled: false, instructions: '' }, actor);
  agentId = listAgents(t.ctx.db)[0]!.id;
  if (connect) {
    await connectZoho(t.ctx);
    await saveSettings(settings);
  }
  return actor;
}

async function customerSays(id: string, text: string, chatJid = jid, senderName = 'Kavitha') {
  await getMessages(t.ctx).ingest(
    {
      id,
      chatJid,
      body: text,
      type: 'text',
      fromMe: false,
      senderJid: chatJid,
      senderName,
      timestamp: Date.now(),
      quotedId: null,
      media: null,
    },
    'live',
  );
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS + 1500);
}

const toolEvents = (chatJid = jid) =>
  getChats(t.ctx)
    .events(chatJid)
    .filter((e) => e.type === 'ai_tool_used')
    .map((e) => e.payload);
const activity = () =>
  t.ctx.db.prepare('SELECT kind, module, reason FROM zoho_crm_activity ORDER BY id').all();
const fake = () => t.ctx.services.zohoCrm!.fake!;
const leads = () => fake().records.filter((r) => r.module === 'Leads');
const log = pino({ level: 'silent' });

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(async () => {
  await t?.close();
  vi.useRealTimers();
});

describe('Zoho CRM AI tools (live)', () => {
  it('finds a known customer, writes one found line, and never offers add_crm_lead when off', async () => {
    const actor = await setUp();
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    let found = '';
    script = async (tools, signal) => {
      expect(Object.keys(tools)).toContain('find_crm_customer');
      expect(Object.keys(tools)).not.toContain('add_crm_lead');
      found = await call(tools, 'find_crm_customer', {}, signal);
      return { reply: 'Hi Farah!', action: 'answer' };
    };
    await customerSays('in-1', 'Hi, is the shop open?', FARAH, 'Farah');
    expect(JSON.parse(found)).toMatchObject({
      found: true,
      type: 'contact',
      name: 'Farah Aziz',
      company: 'Farah Catering Co',
      owner: 'Sales Rep',
      leadStatus: null,
    });
    expect(toolEvents(FARAH)).toEqual([
      { title: 'Find the customer', sourceLabel: 'Zoho CRM', crm: { action: 'found' } },
    ]);
    expect(activity()).toEqual([{ kind: 'found', module: 'Contacts', reason: null }]);
  });

  it('adds a new enquiry as a lead with the customer’s own details, once', async () => {
    const actor = await setUp({ settings: { addLeads: true, ownerId: '4150868000000225021' } });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    let first = '';
    let refused = '';
    script = async (tools, signal) => {
      first = await call(tools, 'find_crm_customer', {}, signal);
      // details the customer did not write are refused
      refused = await call(
        tools,
        'add_crm_lead',
        { name: 'Someone Else', request: 'Catering' },
        signal,
      );
      return { reply: 'May I have your name and company?', action: 'answer' };
    };
    await customerSays('in-1', 'Do you cater office lunches? About 80 pax on 15 Nov.');
    expect(JSON.parse(first)).toMatchObject({ found: false });
    expect(JSON.parse(first).note).toContain('add_crm_lead');
    expect(refused).toContain('pass only details the customer wrote');
    expect(leads()).toHaveLength(1); // the seeded lead only

    let added = '';
    let again = '';
    script = async (tools, signal) => {
      added = await call(
        tools,
        'add_crm_lead',
        {
          name: 'Dr. Kavitha Menon',
          company: 'Bright Dental Clinic',
          email: 'kavitha@brightdental.example',
          request: '  Office lunch catering,\n about 80 pax, 15 Nov.  ',
        },
        signal,
      );
      again = await call(tools, 'add_crm_lead', { request: 'again' }, signal);
      return { reply: 'Thank you, our team will send a quote.', action: 'answer' };
    };
    await customerSays(
      'in-2',
      "I'm Dr. Kavitha Menon from Bright Dental Clinic, kavitha@brightdental.example",
    );
    expect(added).toContain('Added as a lead');
    expect(again).toContain('Already added');
    expect(leads()).toHaveLength(2);
    expect(leads()[1]).toMatchObject({
      firstName: 'Dr. Kavitha',
      lastName: 'Menon',
      company: 'Bright Dental Clinic',
      phone: '+60132228899',
      email: 'kavitha@brightdental.example',
      owner: 'Sales Rep',
      leadSource: 'WhatsApp',
      description: 'Office lunch catering, about 80 pax, 15 Nov.',
    });
    expect(toolEvents().map((e) => e.crm)).toEqual([
      { action: 'not_found' },
      { action: 'lead_added' },
    ]);
    expect(activity()).toEqual([
      { kind: 'not_found', module: null, reason: null },
      { kind: 'added', module: 'Leads', reason: null },
    ]);
    // the customer panel now shows the lead the AI added, with the summary
    const record = await t.ctx.services.zohoCrm!.chatRecord(jid);
    expect(record.record).toMatchObject({
      module: 'Leads',
      name: 'Dr. Kavitha Menon',
      addedBy: 'ai',
      request: 'Office lunch catering, about 80 pax, 15 Nov.',
      url: expect.stringMatching(/^https:\/\/crm\.zoho\.com\/crm\/org700123456\/tab\/Leads\/\d+$/),
    });
  });

  it('keeps answering when Zoho is down: no hand-over, a failed line in Activity', async () => {
    const actor = await setUp({ settings: { addLeads: true } });
    t.ctx.services.ai!.saveMember({ displayName: 'Aina', enabled: true, instructions: '' }, actor);
    fake().mode = 'unavailable';
    let found = '';
    let added = '';
    script = async (tools, signal) => {
      found = await call(tools, 'find_crm_customer', {}, signal);
      added = await call(tools, 'add_crm_lead', { request: 'x' }, signal);
      return { reply: 'We open at 8am.', action: 'answer' };
    };
    await customerSays('in-1', 'What time do you open?');
    expect(found).toContain('not available right now');
    expect(added).toContain('not available right now');
    expect(t.wa.sent.at(-1)?.text).toBe('We open at 8am.');
    expect(getChats(t.ctx).get(jid)?.assignedTo).not.toBeNull();
    expect(activity().map((r) => (r as { kind: string }).kind)).toEqual(['failed', 'not_added']);
    expect((await t.ctx.services.zohoCrm!.status()).state).toBe('unavailable');
  });
});

describe('Zoho CRM tools (direct)', () => {
  const input = (chatJid: string | null, signal = new AbortController().signal) => ({
    agent: 'sales' as const,
    agentId,
    chatJid,
    signal,
  });

  it('are offered only when connected and Find the customer is on; groups get look-ups only', async () => {
    await setUp({ connect: false });
    expect(zohoAgentTools(t.ctx, log, input(jid), {}).tools).toEqual({});
    expect(agentLookupsAvailable(t.ctx, 'sales', agentId)).toBe(false);
    await connectZoho(t.ctx);
    await saveSettings({ addLeads: true });
    expect(agentLookupsAvailable(t.ctx, 'sales', agentId)).toBe(true);
    const all = await agentTurnTools(t.ctx, log, input(jid), { onFailure: () => {} });
    expect(Object.keys(all.tools).sort()).toEqual(['add_crm_lead', 'find_crm_customer']);
    const group = await agentTurnTools(t.ctx, log, input(jid), {
      onFailure: () => {},
      lookupsOnly: true,
    });
    expect(Object.keys(group.tools)).toEqual(['find_crm_customer']);
    await saveSettings({ find: false, addLeads: false });
    expect(zohoAgentTools(t.ctx, log, input(jid), {}).tools).toEqual({});
  });

  it('Try it looks nothing up and adds nothing', async () => {
    await setUp({ settings: { addLeads: true } });
    const turn = zohoAgentTools(t.ctx, log, input(null), {});
    const signal = new AbortController().signal;
    expect(await call(turn.tools, 'find_crm_customer', {}, signal)).toContain('Test only');
    expect(await call(turn.tools, 'add_crm_lead', { request: 'x' }, signal)).toContain('Test only');
    expect(turn.calls().map((c) => [c.tool, c.notRun ?? false])).toEqual([
      ['find_crm_customer', false],
      ['add_crm_lead', true],
    ]);
    expect(turn.used()).toEqual([]);
    expect(leads()).toHaveLength(1);
  });

  it('refuses a lead without a name or for a number already in Zoho CRM', async () => {
    await setUp({ settings: { addLeads: true } });
    const zoho = t.ctx.services.zohoCrm!;
    await customerSays('in-1', 'hello', '60139990001@s.whatsapp.net', '');
    // the chat is named after its number: no name
    expect(await zoho.addLeadByAi(agentId, '60139990001@s.whatsapp.net', { request: 'x' })).toEqual(
      { ok: false, reason: 'no_name' },
    );
    await customerSays('in-2', 'hi', FARAH, 'Farah');
    expect(await zoho.addLeadByAi(agentId, FARAH, { request: 'x' })).toEqual({
      ok: false,
      reason: 'exists',
      module: 'Contacts',
    });
    await customerSays('in-3', 'my email is not-an-email', jid);
    expect(await zoho.addLeadByAi(agentId, jid, { email: 'not-an-email' })).toEqual({
      ok: false,
      reason: 'invalid_email',
    });
    await saveSettings({ addLeads: false });
    expect(await zoho.addLeadByAi(agentId, jid, {})).toEqual({ ok: false, reason: 'not_allowed' });
    expect(leads()).toHaveLength(1);
  });

  it('leaves the request summary out when the setting is off', async () => {
    await setUp({ settings: { addLeads: true, includeRequest: false } });
    await customerSays('in-1', 'Quote for 50 pax please', jid);
    const result = await t.ctx.services.zohoCrm!.addLeadByAi(agentId, jid, {
      request: 'Quote for 50 pax',
    });
    expect(result).toMatchObject({ ok: true, already: false });
    expect(leads()[1]).toMatchObject({ lastName: 'Kavitha', description: null });
  });

  it('moves the lead and activity rows when two chats merge', async () => {
    await setUp({ settings: { addLeads: true } });
    await customerSays('in-1', 'Quote please', jid);
    await t.ctx.services.zohoCrm!.addLeadByAi(agentId, jid, { request: 'Quote' });
    const lid = '123456789012345@lid';
    getChats(t.ctx).upsertFromWa({ jid: lid, name: 'Kavitha', type: 'dm' });
    mergeChat(t.ctx.db, jid, lid, { now: Date.now() });
    expect(t.ctx.db.prepare('SELECT chat_jid FROM zoho_crm_leads').all()).toEqual([
      { chat_jid: lid },
    ]);
    expect(t.ctx.db.prepare('SELECT DISTINCT chat_jid FROM zoho_crm_activity').all()).toEqual([
      { chat_jid: lid },
    ]);
  });
});

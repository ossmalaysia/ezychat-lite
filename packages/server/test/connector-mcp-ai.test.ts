// The AI bridge of partner (MCP) connectors: tools offered per agent, the declared guards, Try it,
// Activity, chat lines, failures (hand-over) and chat merges, against the local partner MCP server.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';
import { ConnectorEntry, type ConnectorGallery } from '@ezychat/shared';
import { agentById, listAgents } from '../src/ai/agents.js';
import { agentTurnTools, agentLookupsAvailable } from '../src/ai/agent/turn-tools.js';
import { createAiService } from '../src/ai/service.js';
import type { AiPrompt, AiProvider } from '../src/ai/provider-types.js';
import type { AiToolCallEvent } from '../src/index.js';
import { mergeChat } from '../src/chats/merge.js';
import type { AppContext } from '../src/context.js';
import type { ConnectorListService } from '../src/connectors/list/types.js';
import { createConnectorMcpService } from '../src/connectors/mcp/service.js';
import { mcpConnectorLookupsAvailable } from '../src/connectors/mcp/tools.js';
import { silentLogger } from '../src/logger.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { partnerEntries } from '../../../e2e/partner-mcp/list.mjs';
import {
  PARTNER_CREDENTIALS,
  startPartnerMcp,
  type PartnerKit,
} from '../../../e2e/partner-mcp/server.mjs';
import { makeTestApp, type TestApp } from './helpers.js';

const jid = '60123456789@s.whatsapp.net';
const FIND = 'test-kedai__find_invoice';
const STOCK = 'test-kedai__check_stock';
const QUOTE = 'test-kedai__create_quotation';

let kit: PartnerKit;
let t: TestApp;
let entries: ConnectorEntry[];
let agentId: number;
let aiUserId: number;
let clock: number;
let script: (tools: ToolSet, signal: AbortSignal) => Promise<{ reply: string; action: 'answer' }>;
const actor = { userId: 1, ip: null };

beforeAll(async () => {
  kit = await startPartnerMcp({ port: 0, tls: true });
});
afterAll(async () => {
  await kit.close();
});
const turns: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  for (const open of turns.splice(0)) await open.dispose();
  await t?.close();
  for (const id of ['api-key', 'oauth'] as const) kit.setState(id, 'ok');
});

function fakeList(): ConnectorListService {
  return {
    status: () => ({
      state: 'loaded',
      generatedAt: null,
      sequence: 1,
      checkedAt: null,
      appVersion: '0',
      hidden: 0,
    }),
    entry: (id) => entries.find((e) => e.id === id) ?? null,
    gallery: () => ({}) as ConnectorGallery,
    refresh: async () => ({}) as ConnectorGallery,
    shutdown: () => undefined,
  };
}

async function setUp({ write = true } = {}) {
  clock = Date.now();
  entries = (partnerEntries(kit.origin) as unknown[]).map((e) => ConnectorEntry.parse(e));
  const provider: AiProvider = {
    generate: vi.fn(async (_s, _k, prompt: AiPrompt, signal: AbortSignal) =>
      script(prompt.tools ?? {}, signal),
    ) as AiProvider['generate'],
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    beforeBuild: async (ctx: AppContext) => {
      await ctx.services.ai!.shutdown();
      ctx.services.ai = createAiService(ctx, { provider, isOnline: () => true });
      ctx.services.connectorList = fakeList();
      const service = createConnectorMcpService(ctx, {
        env: { CONNECTORS_TEST_ALLOW_LOCAL: '1' },
        net: { ca: kit.cert },
        now: () => clock,
      });
      ctx.services.connectorMcp = service;
      ctx.services.connectorConnections = service.port;
    },
  });
  t.ctx.services.auth!.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  ai.saveMember({ displayName: 'Aina', enabled: false, instructions: '' }, actor);
  agentId = listAgents(t.ctx.db)[0]!.id;
  aiUserId = agentById(t.ctx.db, agentId)!.userId;
  const svc = t.ctx.services.connectorMcp!;
  await svc.connect(
    'test-kedai',
    { fields: { key: PARTNER_CREDENTIALS.apiKey } },
    'http://127.0.0.1:1/cb',
    actor,
  );
  if (write)
    svc.putAgentSettings(
      'test-kedai',
      agentId,
      { settings: {}, tools: { create_quotation: true } },
      actor,
    );
}

let seq = 0;
async function customerSays(text: string) {
  clock += 1000;
  await getMessages(t.ctx).ingest(
    {
      id: `in-${++seq}`,
      chatJid: jid,
      body: text,
      type: 'text',
      fromMe: false,
      senderJid: jid,
      senderName: 'Mei Ying',
      timestamp: clock,
      quotedId: null,
      media: null,
    },
    'live',
  );
}

function aiReplies(text: string) {
  clock += 1000;
  t.ctx.db
    .prepare(
      `INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, timestamp, created_at)
       VALUES (?, ?, 1, ?, 'text', ?, ?, ?)`,
    )
    .run(`out-${++seq}`, jid, aiUserId, text, clock, clock);
}

async function turn(chatJid: string | null = jid) {
  const onFailure = vi.fn();
  const controller = new AbortController();
  const result = await agentTurnTools(
    t.ctx,
    silentLogger(),
    { agent: 'sales', agentId, chatJid, signal: controller.signal },
    { onFailure },
  );
  turns.push(result);
  const call = (name: string, input: object) => {
    const execute = result.tools[name]?.execute as
      ((i: object, o: object) => Promise<string>) | undefined;
    if (!execute) throw new Error(`tool ${name} not offered`);
    return execute(input, {
      toolCallId: `call-${name}`,
      messages: [],
      abortSignal: controller.signal,
    });
  };
  return { ...result, call, onFailure, controller };
}

const activity = () =>
  (
    t.ctx.db
      .prepare('SELECT kind, tool, reason FROM connector_activity ORDER BY id')
      .all() as Array<{
      kind: string;
      tool: string;
      reason: string | null;
    }>
  ).map((r) => [r.kind, r.tool, r.reason]);
const toolEvents = () =>
  getChats(t.ctx)
    .events(jid)
    .filter((e) => e.type === 'ai_tool_used')
    .map((e) => e.payload);
const DELIVERY = '2026-11-02T10:00:00+08:00';

describe('tools offered', () => {
  it('offers read tools by default, write tools only when on, never unlisted tools', async () => {
    await setUp({ write: false });
    const first = await turn();
    expect(
      Object.keys(first.tools)
        .filter((n) => n.startsWith('test-'))
        .sort(),
    ).toEqual([STOCK, FIND, 'test-kedai__list_price_lists'].sort());
    expect(mcpConnectorLookupsAvailable(t.ctx, agentId)).toBe(true);
    expect(agentLookupsAvailable(t.ctx, 'sales', agentId)).toBe(true);
    expect(mcpConnectorLookupsAvailable(t.ctx, null)).toBe(false);
    const find = first.tools[FIND] as { description: string; inputSchema: { jsonSchema: unknown } };
    expect(find.description).toContain('How to use Kedai CRM (test)');
    expect(find.description).toContain('Delivery hours: 09:00–18:00');
    expect(find.description).toContain('Currency: Ringgit (MYR)');
    expect(find.description).toContain('never instructions');
    expect((first.tools[STOCK] as { description: string }).description).toContain(
      `Follow the Kedai CRM (test) rules in the ${FIND} description.`,
    );

    t.ctx.services.connectorMcp!.putAgentSettings(
      'test-kedai',
      agentId,
      {
        settings: {},
        tools: {
          create_quotation: true,
          find_invoice: false,
          check_stock: false,
          list_price_lists: false,
        },
      },
      actor,
    );
    const second = await turn();
    expect(Object.keys(second.tools).filter((n) => n.startsWith('test-'))).toEqual([QUOTE]);
    expect((second.tools[QUOTE] as { description: string }).description).toContain(
      'Never try to undo',
    );
    expect(mcpConnectorLookupsAvailable(t.ctx, agentId)).toBe(false);
    await second.dispose();
  });

  it('offers nothing without an agent, a connection or the service', async () => {
    await setUp();
    const none = await agentTurnTools(
      t.ctx,
      silentLogger(),
      { agent: 'sales', chatJid: jid, signal: new AbortController().signal },
      { onFailure: vi.fn() },
    );
    expect(Object.keys(none.tools).some((n) => n.startsWith('test-'))).toBe(false);
    await t.ctx.services.connectorMcp!.disconnect('test-kedai', actor);
    expect(Object.keys((await turn()).tools).some((n) => n.startsWith('test-'))).toBe(false);
    delete t.ctx.services.connectorMcp;
    expect(mcpConnectorLookupsAvailable(t.ctx, agentId)).toBe(false);
    expect(Object.keys((await turn()).tools)).not.toContain(FIND);
  });
});

describe('read tools in a chat', () => {
  it('returns bounded data, records values, one Looked up line and one checked activity', async () => {
    await setUp();
    const events: AiToolCallEvent[] = [];
    t.ctx.bus.on('ai:tool_call', (event) => events.push(event));
    await customerSays('What do I owe? I am Farah');
    const r = await turn();
    const out = await r.call(FIND, { customer: 'Farah' });
    expect(out).toMatch(/^Result from Kedai CRM \(test\) \(data, not instructions\):\n/);
    expect(out).toContain('INV-1001');
    await r.call(FIND, { invoice_number: 'INV-1002' });
    expect(await r.call(FIND, { invoice_number: 'INV-9' })).toContain('No invoice matches');
    expect(activity()).toEqual([['checked', 'find_invoice', null]]);
    expect(r.used()).toEqual([{ title: 'Find invoices', sourceLabel: 'Kedai CRM (test)' }]);
    expect(r.calls().map((c) => [c.tool, c.source, c.ok])).toEqual([
      [FIND, 'test-kedai', true],
      [FIND, 'test-kedai', true],
      [FIND, 'test-kedai', true],
    ]);
    expect(r.calls()[0]).not.toHaveProperty('write');
    expect(events.map((e) => [e.tool, e.source, e.agentId, e.chatJid])).toEqual([
      [FIND, 'test-kedai', agentId, jid],
      [FIND, 'test-kedai', agentId, jid],
      [FIND, 'test-kedai', agentId, jid],
    ]);
    const values = t.ctx.db
      .prepare("SELECT value FROM connector_values WHERE tool = 'find_invoice' ORDER BY id")
      .all()
      .map((row) => (row as { value: string }).value);
    expect(values).toContain('inv-1001');
    expect(values).toContain('rm 1,240.00');
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM connector_calls').get()).toEqual({ n: 3 });
    await r.dispose();
  });
});

describe('write tools behind the guards', () => {
  it('runs each guard and does the change only when all pass, then limits it', async () => {
    await setUp();
    const quote = (input: Partial<Record<string, unknown>> = {}) => ({
      customer_name: 'Mei Ying',
      customer_email: 'mei@example.com',
      sku: 'KA-KY-400',
      quantity: 2,
      delivery_at: DELIVERY,
      ...input,
    });
    await customerSays('Hi, I am Mei Ying (mei@example.com). Can I get a quote for kaya jam?');
    let r = await turn();
    // confirmFirst: the AI has not proposed anything yet.
    expect(await r.call(QUOTE, quote())).toContain('the customer has not confirmed');
    aiReplies('Shall I prepare a quotation for 2 kaya jams?');
    expect(await (await turn()).call(QUOTE, quote())).toContain('the customer has not confirmed');
    await customerSays('Yes please');
    r = await turn();
    // valueFrom: the SKU must come from Check stock in this chat.
    expect(await r.call(QUOTE, quote())).toBe(
      `Not done: "sku" must be a value that ${STOCK} returned in this chat in the last 24 hours. Call ${STOCK} first and pass one of its values unchanged.`,
    );
    await r.call(STOCK, { query: 'kaya' });
    // fromCustomer: the name and email must be the customer's (whole words, 3+ characters); an
    // omitted or renamed one is refused (the renamed key is dropped before the guards).
    expect(await r.call(QUOTE, quote({ customer_name: 'Someone Else' }))).toContain(
      'pass the "customer_name"',
    );
    expect(await r.call(QUOTE, quote({ customer_name: 'Yin' }))).toContain(
      'pass the "customer_name"',
    );
    expect(
      await r.call(QUOTE, quote({ customer_email: undefined, customerEmail: 'x@example.com' })),
    ).toContain('pass the "customer_email"');
    // Arguments must match the partner's fields and types.
    expect(await r.call(QUOTE, quote({ quantity: '2' }))).toContain('do not match the fields');
    expect(await r.call(QUOTE, quote({ sku: undefined }))).toContain('do not match the fields');
    // within: the delivery time must be in the agent's hours.
    expect(await r.call(QUOTE, quote({ delivery_at: '2026-11-02T22:00:00+08:00' }))).toContain(
      '"delivery_at" is outside',
    );
    expect(await r.call(QUOTE, quote({ delivery_at: 'tomorrow' }))).toContain(
      '"delivery_at" is outside',
    );
    expect(kit.state.quotations).toHaveLength(0);

    const done = await r.call(QUOTE, quote());
    expect(done).toContain('"quote":"Q-2001"');
    expect(kit.state.quotations).toEqual([
      expect.objectContaining({
        customer_name: 'Mei Ying',
        sku: 'KA-KY-400',
        delivery_at: DELIVERY,
      }),
    ]);
    // The chat line is written at once; the turn's used() leaves the change out.
    expect(toolEvents()).toEqual([{ title: 'Create quotation', sourceLabel: 'Kedai CRM (test)' }]);
    expect(r.used()).toEqual([{ title: 'Check stock', sourceLabel: 'Kedai CRM (test)' }]);
    // One confirmation, one change: a regenerated reply (a new turn, no new message) is refused.
    expect(await (await turn()).call(QUOTE, quote())).toContain('the customer has not confirmed');
    aiReplies('Done: Q-2001. Anything else?');
    await customerSays('Yes, one more for my company please');
    r = await turn();
    // The saved contact counts as the customer's (fromCustomer).
    t.ctx.services.customers!.save(
      jid,
      {
        name: 'Mei Ying Tan',
        company: '',
        email: 'tan@example.com',
        otherPhone: '',
        address: '',
        tags: [],
      },
      actor,
    );
    expect(
      await r.call(
        QUOTE,
        quote({ customer_name: 'Mei Ying Tan', customer_email: 'tan@example.com' }),
      ),
    ).toContain('Q-2002');
    // limits: perChat 2.
    expect(await r.call(QUOTE, quote())).toContain('the limit for this action was reached');
    expect(kit.state.quotations).toHaveLength(2);
    expect(activity()).toEqual([
      ['refused', 'create_quotation', 'confirm_first'],
      ['refused', 'create_quotation', 'confirm_first'],
      ['refused', 'create_quotation', 'value_from'],
      ['checked', 'check_stock', null],
      ['refused', 'create_quotation', 'from_customer'],
      ['refused', 'create_quotation', 'from_customer'],
      ['refused', 'create_quotation', 'from_customer'],
      ['refused', 'create_quotation', 'within'],
      ['refused', 'create_quotation', 'within'],
      ['done', 'create_quotation', null],
      ['refused', 'create_quotation', 'confirm_first'],
      ['done', 'create_quotation', null],
      ['refused', 'create_quotation', 'limit'],
    ]);
    const list = await t.app.inject({
      method: 'GET',
      url: '/api/connectors/mcp/test-kedai/activity',
    });
    expect(list.statusCode).toBe(401);
    expect(t.ctx.services.connectorMcp!.activity('test-kedai')[0]).toMatchObject({
      kind: 'refused',
      agentName: 'Aina',
      customer: 'Mei Ying Tan',
      tool: 'create_quotation',
      reason: 'limit',
    });
  });

  it('forgets values a read tool returned after 24 hours', async () => {
    await setUp();
    await customerSays('I am Mei Ying, mei@example.com');
    aiReplies('Shall I prepare it?');
    await customerSays('Yes');
    const r = await turn();
    await r.call(STOCK, { query: 'KA-KY-400' });
    clock += 25 * 3_600_000;
    await customerSays('Still want it');
    const input = {
      customer_name: 'Mei Ying',
      sku: 'KA-KY-400',
      quantity: 1,
      delivery_at: DELIVERY,
    };
    expect(await r.call(QUOTE, input)).toContain('"sku" must be a value');
    expect(kit.state.quotations.filter((q) => q.quantity === 1)).toEqual([]);
  });
});

describe('reservations', () => {
  it('lets only one of two parallel calls pass a limit, and frees the call when it fails', async () => {
    await setUp();
    entries[1]!.tools![0]!.guards = { limits: { perChat: 1 } };
    await customerSays('Invoice INV-1001?');
    kit.setState('api-key', 'down');
    let r = await turn();
    await expect(r.call(FIND, { invoice_number: 'INV-1001' })).rejects.toThrow();
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM connector_calls').get()).toEqual({ n: 0 });
    kit.setState('api-key', 'ok');
    r = await turn();
    const both = await Promise.all([
      r.call(FIND, { invoice_number: 'INV-1001' }),
      r.call(FIND, { invoice_number: 'INV-1002' }),
    ]);
    expect(both.filter((out) => out.includes('limit for this action was reached'))).toHaveLength(1);
    expect(both.filter((out) => out.startsWith('Result from'))).toHaveLength(1);
  });

  it('lets only one of two parallel writes use one confirmation', async () => {
    await setUp();
    await customerSays('I am Mei Ying, mei@example.com. Quote 2 kaya jams?');
    aiReplies('Shall I create the quotation?');
    await customerSays('Yes');
    const r = await turn();
    await r.call(STOCK, { query: 'KA-KY-400' });
    const input = {
      customer_name: 'Mei Ying',
      customer_email: 'mei@example.com',
      sku: 'KA-KY-400',
      quantity: 3,
      delivery_at: DELIVERY,
    };
    const both = await Promise.all([r.call(QUOTE, input), r.call(QUOTE, input)]);
    expect(both.filter((out) => out.includes('has not confirmed'))).toHaveLength(1);
    expect(kit.state.quotations.filter((q) => q.quantity === 3)).toHaveLength(1);
  });
});

describe('Try it and failures', () => {
  it('never runs a write tool in Try it, and reports it as not run', async () => {
    await setUp();
    const before = kit.state.calls.length;
    const r = await turn(null);
    expect(
      await r.call(QUOTE, { customer_name: 'x', sku: 'y', quantity: 1, delivery_at: DELIVERY }),
    ).toContain('Test only (Try it): nothing was done');
    expect(await r.call(FIND, { invoice_number: 'INV-1001' })).toContain('INV-1001');
    expect(kit.state.calls.slice(before).map((c) => c.tool)).toEqual(['find_invoice']);
    expect(r.calls().map((c) => [c.tool, c.notRun ?? false])).toEqual([
      [QUOTE, true],
      [FIND, false],
    ]);
    for (const table of [
      'connector_activity',
      'connector_values',
      'connector_calls',
      'chat_events',
    ])
      expect(t.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });

    // The same through the AI service's Try it.
    script = async (tools, signal) => {
      const execute = tools[QUOTE]!.execute as (i: object, o: object) => Promise<string>;
      await execute(
        { customer_name: 'x', sku: 'y', quantity: 1, delivery_at: DELIVERY },
        { toolCallId: 'c', messages: [], abortSignal: signal },
      );
      return { reply: 'Done!', action: 'answer' };
    };
    const result = await t.ctx.services.ai!.tryAnswer({
      question: 'Quote me 2 kaya jams',
      knowledge: { displayName: 'Aina', instructions: '' },
      agentId,
    });
    expect(result.lookups).toEqual([
      expect.objectContaining({
        tool: QUOTE,
        source: 'test-kedai',
        title: 'Create quotation',
        notRun: true,
        ok: true,
      }),
    ]);
  });

  it('marks the turn failed (hand-over) when the partner is down, refuses or errors', async () => {
    await setUp();
    await customerSays('Invoice INV-1001?');
    kit.setState('api-key', 'down');
    let r = await turn();
    await expect(r.call(FIND, { invoice_number: 'INV-1001' })).rejects.toThrow();
    expect(r.failed()).toBe(true);
    expect(r.onFailure).toHaveBeenCalledTimes(1);
    expect(r.calls()[0]).toMatchObject({ ok: false });
    expect(r.used()).toEqual([]);
    expect(t.ctx.services.connectorMcp!.port.view('test-kedai')!.state).toBe('unreachable');

    kit.setState('api-key', 'rpc_error');
    r = await turn();
    await expect(r.call(FIND, { invoice_number: 'INV-1001' })).rejects.toThrow();
    expect(r.failed()).toBe(true);
    expect(t.ctx.services.connectorMcp!.port.view('test-kedai')!.state).toBe('connected');

    kit.setState('api-key', 'refused');
    r = await turn();
    await expect(r.call(FIND, { invoice_number: 'INV-1001' })).rejects.toThrow();
    expect(t.ctx.services.connectorMcp!.port.view('test-kedai')!.state).toBe('needs_sign_in');
    expect(activity()).toEqual([
      ['failed', 'find_invoice', 'unreachable'],
      ['failed', 'find_invoice', 'partner_error'],
      ['failed', 'find_invoice', 'needs_sign_in'],
    ]);

    // A cancelled turn is not a failure.
    kit.setState('api-key', 'ok');
    r = await turn();
    r.controller.abort();
    await expect(r.call(FIND, { invoice_number: 'INV-1001' })).rejects.toThrow();
    expect(r.failed()).toBe(false);
    await r.dispose();
  });
});

describe('chat merge', () => {
  it('moves connector activity, values and calls to the merged chat', async () => {
    await setUp();
    const lid = '123456789@lid';
    const chats = getChats(t.ctx);
    chats.upsertFromWa({ jid, type: 'dm', name: 'Mei Ying' });
    chats.upsertFromWa({ jid: lid, type: 'dm', name: 'Mei Ying' });
    const svc = t.ctx.services.connectorMcp!;
    svc.addActivity({
      connectorId: 'test-kedai',
      kind: 'checked',
      agentId,
      chatJid: jid,
      tool: 'check_stock',
    });
    svc.recordValues('test-kedai', jid, 'check_stock', ['KA-KY-400']);
    svc.recordCall('test-kedai', 'check_stock', jid);
    mergeChat(t.ctx.db, jid, lid, { now: 10 });
    for (const table of ['connector_activity', 'connector_values', 'connector_calls']) {
      const count = (chat: string) =>
        (
          t.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE chat_jid = ?`).get(chat) as {
            n: number;
          }
        ).n;
      expect(count(jid), table).toBe(0);
      expect(count(lid), table).toBe(1);
    }
  });
});

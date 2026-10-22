import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiMemberBody } from '@ezychat/shared';
import { tool, type ToolSet } from 'ai';
import { createAiService, AI_FALLBACK_MS } from '../src/ai/service.js';
import { HANDOFF_REPLY } from '../src/ai/prompt.js';
import type { AiPrompt, AiProvider } from '../src/ai/provider-types.js';
import {
  ToolHandoverError,
  tryAgentReply,
  tunnelPublicUrls,
  type AgentToolsInput,
  type AiToolCallEvent,
  type ServerExtension,
} from '../src/index.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { extensionLookupsAvailable } from '../src/ai/agent/extension-tools.js';
import { createMessageService } from '../src/messages/service.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

let t: TestApp;
let provider: AiProvider;
let cookie: string;
let inputs: AgentToolsInput[];
let disposed: number;
let lookup: (args: { orderId: string }) => Promise<string>;
let extraTools: ToolSet;
const jid = 'customer@s.whatsapp.net';
const body: AiMemberBody = { displayName: 'Sales Agent', enabled: true, instructions: '' };

const orders: ServerExtension = {
  name: 'connectors',
  async agentTools(_ctx, input) {
    inputs.push(input);
    return {
      tools: {
        get_order_status: tool({
          description: 'Order status',
          inputSchema: z.object({ orderId: z.string() }),
          execute: (args) => lookup(args),
        }),
        ...extraTools,
      },
      info: { get_order_status: { title: 'Get order status', sourceLabel: 'Demo catalogue' } },
      dispose: async () => {
        disposed++;
      },
    };
  },
};

/** A model that calls `get_order_status` once, then answers (or stops when the turn aborts). */
function callingModel(): AiProvider['generate'] {
  return async (_settings, _key, prompt: AiPrompt, signal) => {
    const execute = prompt.tools?.get_order_status?.execute as (
      input: object,
      options: object,
    ) => Promise<unknown>;
    await execute(
      { orderId: 'A-1001' },
      { toolCallId: 'call-1', messages: [], abortSignal: signal },
    ).catch(() => {});
    signal.throwIfAborted();
    return { reply: 'Your order A-1001 has shipped.', action: 'answer' };
  };
}

async function setUp(extensions: ServerExtension[], { context = true } = {}) {
  inputs = [];
  disposed = 0;
  extraTools = {};
  lookup = async () => 'shipped';
  provider = {
    generate: vi.fn(callingModel()),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  // Before the routes capture the services, so POST /api/ai/try uses this provider too.
  t = await makeTestApp({
    extensions,
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
  const auth = t.ctx.services.auth!;
  const admin = auth.createUser({
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  const actor = { userId: admin.id, ip: null };
  cookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 'test' })}`;
  t.ctx.services.ai!.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123' }, actor);
  t.ctx.services.ai!.saveMember({ ...body, enabled: false }, actor);
  if (context)
    t.ctx.services.ai!.addText(null, { name: 'Business context', text: 'Orders ship in 2 days.' }, actor);
  if (context || extensionLookupsAvailable(t.ctx, 'sales'))
    t.ctx.services.ai!.saveMember(body, actor);
}

async function incoming(id = 'in-1', text = 'Where is order A-1001?') {
  return getMessages(t.ctx).ingest(
    {
      id,
      chatJid: jid,
      body: text,
      type: 'text',
      fromMe: false,
      senderJid: jid,
      senderName: 'Customer',
      timestamp: Date.now(),
      quotedId: null,
      media: null,
    },
    'live',
  );
}

async function answerLive() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  await incoming();
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS + 1500);
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(async () => {
  await t?.close();
  vi.useRealTimers();
});

it('merges extension tools with the core tools for a live reply and disposes them', async () => {
  await setUp([orders]);
  const events: AiToolCallEvent[] = [];
  t.ctx.bus.on('ai:tool_call', (event) => events.push(event));
  await answerLive();
  expect(provider.generate).toHaveBeenCalledTimes(1);
  const prompt = vi.mocked(provider.generate).mock.calls[0]![2];
  expect(Object.keys(prompt.tools ?? {})).toEqual(['get_order_status']);
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toMatchObject({ agent: 'sales', chatJid: jid });
  expect(inputs[0]!.signal).toBeInstanceOf(AbortSignal);
  expect(disposed).toBe(1);
  expect(t.wa.sent[0]?.text).toContain('shipped');
  // The bus event names the call; never its input or output.
  expect(events).toHaveLength(1);
  expect(Object.keys(events[0]!).sort()).toEqual(
    ['agent', 'agentId', 'chatJid', 'ms', 'ok', 'source', 'title', 'tool'].sort(),
  );
  expect(events[0]).toMatchObject({
    agent: 'sales',
    chatJid: jid,
    tool: 'get_order_status',
    source: 'connectors',
    title: 'Get order status',
    ok: true,
  });
  expect(JSON.stringify(events)).not.toContain('A-1001');
  expect(JSON.stringify(events)).not.toContain('shipped');
});

it('records an "AI looked up" chat event above the AI reply, title and source only', async () => {
  await setUp([orders]);
  const live: string[] = [];
  t.ctx.bus.on('chat:event', (event) => live.push(event.type));
  await answerLive();
  const events = getChats(t.ctx).events(jid);
  const used = events.filter((event) => event.type === 'ai_tool_used');
  expect(used).toHaveLength(1);
  expect(used[0]!.payload).toEqual({ title: 'Get order status', sourceLabel: 'Demo catalogue' });
  expect(used[0]!.actorId).toBe(t.ctx.services.ai!.status().member!.id);
  expect(live).toContain('ai_tool_used');
  const reply = getMessages(t.ctx)
    .list(jid, { limit: 10 })
    .messages.find((message) => message.fromMe)!;
  expect(used[0]!.at).toBeLessThanOrEqual(reply.timestamp);
  // The chat stays with the AI: the event is not an assignment change.
  expect(getChats(t.ctx).get(jid)?.assignedTo).toBe(t.ctx.services.ai!.status().member!.id);
});

it('hands the chat over with lookup_failed when an extension tool throws', async () => {
  await setUp([orders]);
  lookup = async () => {
    throw new ToolHandoverError('order system down: secret detail');
  };
  const events: AiToolCallEvent[] = [];
  const handoffs: unknown[] = [];
  t.ctx.bus.on('ai:tool_call', (event) => events.push(event));
  t.ctx.bus.on('ai:handoff', (chat) => handoffs.push(chat));
  await answerLive();
  expect(events).toEqual([expect.objectContaining({ tool: 'get_order_status', ok: false })]);
  expect(t.wa.sent[0]?.text).toBe(HANDOFF_REPLY);
  expect(handoffs).toHaveLength(1);
  expect(getChats(t.ctx).get(jid)?.assignedTo).not.toBe(t.ctx.services.ai!.status().member!.id);
  const audit = t.ctx.db
    .prepare("SELECT meta FROM audit_log WHERE action = 'ai.handoff'")
    .get() as { meta: string };
  expect(JSON.parse(audit.meta).reason).toBe('lookup_failed');
  const handedEvent = getChats(t.ctx)
    .events(jid)
    .find((event) => event.payload.handoff !== undefined);
  expect(handedEvent?.payload.handoff).toBe('lookup_failed');
  // A failed look-up is no "AI looked up" line.
  expect(
    getChats(t.ctx)
      .events(jid)
      .some((event) => event.type === 'ai_tool_used'),
  ).toBe(false);
  expect(disposed).toBe(1);
});

it('treats any error thrown by an extension tool as a failed look-up', async () => {
  await setUp([orders]);
  lookup = async () => {
    throw new TypeError('boom');
  };
  await answerLive();
  const audit = t.ctx.db
    .prepare("SELECT meta FROM audit_log WHERE action = 'ai.handoff'")
    .get() as { meta: string };
  expect(JSON.parse(audit.meta).reason).toBe('lookup_failed');
});

it('leaves out tools that collide with core or another extension, or have invalid names', async () => {
  const second: ServerExtension = {
    name: 'second',
    async agentTools() {
      return {
        tools: {
          get_order_status: tool({
            inputSchema: z.object({}),
            execute: async () => 'dup',
          }),
          second_tool: tool({ inputSchema: z.object({}), execute: async () => 'ok' }),
        },
      };
    },
  };
  await setUp([orders, second]);
  extraTools = {
    search_business_context: tool({ inputSchema: z.object({}), execute: async () => 'x' }),
    'bad name!': tool({ inputSchema: z.object({}), execute: async () => 'x' }),
  };
  await answerLive();
  const prompt = vi.mocked(provider.generate).mock.calls[0]![2];
  expect(Object.keys(prompt.tools ?? {}).sort()).toEqual(['get_order_status', 'second_tool']);
  // The kept get_order_status is the first extension's.
  expect(t.wa.sent[0]?.text).toContain('shipped');
});

it('offers no extra tools and no events without extensions (Lite)', async () => {
  await setUp([]);
  vi.mocked(provider.generate).mockResolvedValue({ reply: 'Ships in 2 days.', action: 'answer' });
  const events: AiToolCallEvent[] = [];
  t.ctx.bus.on('ai:tool_call', (event) => events.push(event));
  await answerLive();
  expect(Object.keys(vi.mocked(provider.generate).mock.calls[0]![2].tools ?? {})).toEqual([]);
  expect(events).toEqual([]);
  expect(
    getChats(t.ctx)
      .events(jid)
      .some((event) => event.type === 'ai_tool_used'),
  ).toBe(false);
});

const ask = (question: string) =>
  t.app.inject({
    method: 'POST',
    url: '/api/ai/try',
    headers: authHeaders(cookie),
    payload: { question, knowledge: { displayName: 'Agent', instructions: '' } },
  });

it('Try it uses extension tools without a chat and lists the look-ups', async () => {
  await setUp([orders]);
  const events: AiToolCallEvent[] = [];
  t.ctx.bus.on('ai:tool_call', (event) => events.push(event));
  const res = await ask('Where is order A-1001?');
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({
    ok: true,
    action: 'answer',
    lookups: [
      {
        tool: 'get_order_status',
        source: 'connectors',
        title: 'Get order status',
        sourceLabel: 'Demo catalogue',
        ok: true,
      },
    ],
  });
  expect(inputs[0]).toMatchObject({ agent: 'sales', chatJid: null });
  expect(events[0]).toMatchObject({ chatJid: null, ok: true });
  expect(disposed).toBe(1);
  expect(t.ctx.db.prepare('SELECT count(*) AS n FROM chat_events').get()).toEqual({ n: 0 });
});

it('Try it returns the lookup_failed hand-over when a look-up fails', async () => {
  await setUp([orders]);
  lookup = async () => {
    throw new ToolHandoverError('down');
  };
  const res = await ask('Where is order A-1001?');
  expect(res.json()).toMatchObject({
    ok: true,
    action: 'handoff',
    handoffReason: 'lookup_failed',
    reply: HANDOFF_REPLY,
    lookups: [{ tool: 'get_order_status', ok: false }],
  });
  expect(disposed).toBe(1);
});

it('tryAgentReply answers with the saved setup for extension routes', async () => {
  await setUp([orders]);
  const result = await tryAgentReply(t.ctx, { agent: 'sales', question: 'Order A-1001?' });
  expect(result).toMatchObject({ ok: true, action: 'answer' });
  expect(result.lookups).toHaveLength(1);
  await expect(tryAgentReply(t.ctx, { agent: 'sales', question: ' ' })).rejects.toThrow();
});

it('tunnelPublicUrls lists the running Phone access address only', async () => {
  await setUp([]);
  const status = {
    mode: 'quick' as const,
    state: 'running' as const,
    url: 'https://abc.trycloudflare.com',
    hostname: null,
    lastError: null,
    logTail: [],
  };
  const tunnel = t.ctx.services.tunnel!;
  const spy = vi.spyOn(tunnel, 'status');
  spy.mockReturnValue(status);
  expect(tunnelPublicUrls(t.ctx)).toEqual(['https://abc.trycloudflare.com']);
  spy.mockReturnValue({ ...status, state: 'starting' });
  expect(tunnelPublicUrls(t.ctx)).toEqual([]);
  spy.mockReturnValue({ ...status, url: 'http://abc.example' });
  expect(tunnelPublicUrls(t.ctx)).toEqual([]);
});

describe('look-ups count as a fact source when the Business context is empty', () => {
  const withLookups = (available: () => boolean): ServerExtension => ({
    ...orders,
    hasAgentLookups: () => available(),
  });
  it('turns the agent on, answers live and in Try it through the look-up', async () => {
    // setUp turns the agent on: saveMember accepts it without Business context.
    await setUp([withLookups(() => true)], { context: false });
    const res = await ask('Where is order A-1001?');
    expect(res.json()).toMatchObject({ ok: true, action: 'answer' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    await answerLive();
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(t.wa.sent[0]?.text).toContain('shipped');
  });

  it('still hands over at once (no model call) when no extension offers a look-up', async () => {
    await setUp([withLookups(() => false)], { context: false });
    const res = await ask('Where is order A-1001?');
    expect(res.json()).toMatchObject({
      ok: true,
      action: 'handoff',
      handoffReason: 'missing_facts',
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('treats a throwing look-up check as no look-ups', async () => {
    await setUp(
      [
        withLookups(() => {
          throw new Error('boom');
        }),
      ],
      { context: false },
    );
    expect(extensionLookupsAvailable(t.ctx, 'sales')).toBe(false);
    const res = await ask('Where is order A-1001?');
    expect(res.json()).toMatchObject({ action: 'handoff', handoffReason: 'missing_facts' });
  });
});

// Custom AI agents, Task 7: the MCP AI-setup tools take an optional agentId. Without it they mean
// the agent of inbox 1 (old clients), with it only that agent is read or changed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@ezychat/shared';
import type { AiPrompt, AiProvider } from '../src/ai/provider-types.js';
import { createAiService, type AiService } from '../src/ai/service.js';
import { setMcpEnabled } from '../src/mcp/settings.js';
import { makeTestApp, type TestApp } from './helpers.js';

const ACCEPT = 'application/json, text/event-stream';
let t: TestApp;
let admin: User;
let ai: AiService;
let secret: string;
let tokenId: number;
let provider: AiProvider;
let sales: number;
let helpdesk: number;
let id = 0;

async function rpc(method: string, params?: Record<string, unknown>) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/mcp',
    remoteAddress: '127.0.0.1',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
      accept: ACCEPT,
      authorization: `Bearer ${secret}`,
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) }),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await rpc('tools/call', { name, arguments: args })).result as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return {
    isError: result.isError === true,
    text: result.content[0]!.text,
    data: () => JSON.parse(result.content[0]!.text),
  };
}

const auditMetas = (action: string) =>
  (
    t.ctx.db
      .prepare('SELECT meta FROM audit_log WHERE action = ? ORDER BY id')
      .all(action) as Array<{
      meta: string;
    }>
  ).map((r) => JSON.parse(r.meta) as Record<string, unknown>);

beforeEach(async () => {
  t = await makeTestApp({ maxInboxes: 3, inboxes: 2 });
  admin = t.ctx.services.auth!.createUser({
    username: 'owner',
    displayName: 'Owner',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  await t.ctx.services.ai!.shutdown();
  provider = {
    generate: vi.fn().mockResolvedValue({ reply: 'We open at 8am.', action: 'answer' }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(),
  };
  ai = createAiService(t.ctx, { provider });
  t.ctx.services.ai = ai;
  const actor = { userId: admin.id, ip: null };
  ai.saveConnection({ mode: 'api', model: '', apiKey: 'test-api-key-123456' }, actor);
  // The inbox-2 agent is created first, so the inbox-1 agent is not the lowest id.
  helpdesk = ai.createAgent(
    {
      displayName: 'Helpdesk',
      enabled: false,
      preset: 'faq',
      instructions: 'Answer clinic questions.',
      handoffRules: '- The patient asks for a doctor',
      inboxId: 2,
    },
    actor,
  ).agent.id;
  sales = ai.createAgent(
    {
      displayName: 'Sales Agent',
      enabled: false,
      preset: 'sales',
      instructions: 'Be concise.',
      handoffRules: '- The customer wants a quotation',
      inboxId: 1,
    },
    actor,
  ).agent.id;
  ai.addText(sales, { name: 'Prices', text: 'ChatGPT Business costs RM120 per user.' }, actor);
  ai.addText(helpdesk, { name: 'Hours', text: 'The clinic opens at 8am on weekdays.' }, actor);
  setMcpEnabled(t.ctx, true);
  const created = t.ctx.services.apiTokens!.create(
    admin.id,
    { name: 'test', expiresInDays: 30 },
    'ip',
  );
  secret = created.secret;
  tokenId = created.token.id;
});
afterEach(async () => {
  await t.close();
});

describe('MCP AI-setup tools with several agents', { timeout: 30_000 }, () => {
  it('list_ai_agents lists every agent with its preset and inbox', async () => {
    const tools = (await rpc('tools/list')).result.tools as Array<{
      name: string;
      title: string;
      description: string;
      annotations?: { readOnlyHint?: boolean };
    }>;
    const list = tools.find((x) => x.name === 'list_ai_agents');
    expect(list?.annotations?.readOnlyHint).toBe(true);
    // Neutral wording: every agent, not only a sales one.
    for (const tool of tools.filter((x) => x.name.includes('_ai_')))
      expect(`${tool.title} ${tool.description}`).not.toMatch(/Sales Agent/);

    const res = await call('list_ai_agents');
    expect(res.isError).toBe(false);
    expect(res.data()).toEqual({
      agents: [
        { id: helpdesk, name: 'Helpdesk', preset: 'faq', inboxId: 2, enabled: false },
        { id: sales, name: 'Sales Agent', preset: 'sales', inboxId: 1, enabled: false },
      ],
    });
  });

  it('the server instructions name the AI agents and agentId, not the Sales Agent', async () => {
    const init = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const instructions = init.result.instructions as string;
    expect(instructions).toContain('list_ai_agents');
    expect(instructions).toContain('agentId');
    expect(instructions).not.toMatch(/Sales Agent/);
  });

  it('without agentId reads and changes the inbox-1 agent only (old clients)', async () => {
    const setup = (await call('get_ai_agent_setup')).data();
    expect(setup).toMatchObject({
      agentId: sales,
      name: 'Sales Agent',
      preset: 'sales',
      inboxId: 1,
      instructions: 'Be concise.',
    });
    expect(setup.businessContext.map((d: { name: string }) => d.name)).toEqual(['Prices']);
    expect(setup.businessContext[0]).toMatchObject({ internal: false, editable: true });

    const saved = await call('update_ai_setup', {
      target: 'instructions',
      text: 'Be warm.',
      reason: 'friendlier tone',
    });
    expect(saved.isError).toBe(false);
    expect(ai.agentStatus(sales).settings.instructions).toBe('Be warm.');
    expect(ai.agentStatus(helpdesk).settings.instructions).toBe('Answer clinic questions.');

    const added = await call('update_ai_setup', {
      target: 'context_text',
      name: 'Delivery',
      text: 'We deliver in three days.',
      reason: 'delivery questions',
    });
    expect(added.isError).toBe(false);
    expect(ai.agentStatus(sales).documents.map((d) => d.name)).toEqual(['Prices', 'Delivery']);
    expect(ai.agentStatus(helpdesk).documents.map((d) => d.name)).toEqual(['Hours']);
    // Only the one agent: no second inbox-1 agent appears.
    expect(ai.listAgents()).toHaveLength(2);
  });

  it('with agentId reads, tests and changes that agent only', async () => {
    const setup = (await call('get_ai_agent_setup', { agentId: helpdesk })).data();
    expect(setup).toMatchObject({
      agentId: helpdesk,
      name: 'Helpdesk',
      preset: 'faq',
      inboxId: 2,
      instructions: 'Answer clinic questions.',
      handoffRules: '- The patient asks for a doctor',
    });
    const hours = setup.businessContext[0];
    expect(hours.name).toBe('Hours');
    const item = (await call('get_ai_context_item', { agentId: helpdesk, id: hours.id })).data();
    expect(item).toMatchObject({ name: 'Hours', internal: false });
    // The item id of another agent is not found under the default agent.
    expect((await call('get_ai_context_item', { id: hours.id })).isError).toBe(true);

    const res = await call('update_ai_setup', {
      agentId: helpdesk,
      target: 'handoff_rules',
      text: '- The patient asks for a refund',
      reason: 'refunds go to the team',
    });
    expect(res.isError).toBe(false);
    expect(ai.agentStatus(helpdesk).settings.handoffRules).toBe('- The patient asks for a refund');
    expect(ai.agentStatus(sales).settings.handoffRules).toBe('- The customer wants a quotation');

    const tried = await call('try_ai_reply', { agentId: helpdesk, message: 'When do you open?' });
    expect(tried.isError).toBe(false);
    const prompt = vi.mocked(provider.generate).mock.calls[0]![2] as AiPrompt;
    expect(prompt.input).toContain('opens at 8am');
    expect(prompt.input).not.toContain('RM120');
  });

  it('adds an Internal text item and can change the flag of an existing one', async () => {
    const added = await call('update_ai_setup', {
      agentId: helpdesk,
      target: 'context_text',
      name: 'Floor price',
      text: 'Never discount below RM 90 a visit.',
      internal: true,
      reason: 'pricing guidance for the agent',
    });
    expect(added.isError).toBe(false);
    const setup = (await call('get_ai_agent_setup', { agentId: helpdesk })).data();
    const floor = setup.businessContext.find((d: { name: string }) => d.name === 'Floor price');
    expect(floor).toMatchObject({ internal: true, editable: true });
    expect(auditMetas('ai.document_add').at(-1)).toMatchObject({
      agentId: helpdesk,
      internal: true,
      via: 'mcp',
      tokenId,
    });

    const hours = setup.businessContext.find((d: { name: string }) => d.name === 'Hours');
    const flagged = await call('update_ai_setup', {
      agentId: helpdesk,
      target: 'context_text',
      itemId: hours.id,
      text: 'The clinic opens at 8am on weekdays.',
      internal: true,
      reason: 'keep hours internal',
    });
    expect(flagged.isError).toBe(false);
    expect(ai.document(helpdesk, hours.id).internal).toBe(true);

    const wrong = await call('update_ai_setup', {
      agentId: helpdesk,
      target: 'instructions',
      text: 'x',
      internal: true,
      reason: 'internal on instructions',
    });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/context_text only/);
  });

  it('an unknown agentId is a tool error agent_not_found and changes nothing', async () => {
    for (const [tool, args] of [
      ['get_ai_agent_setup', {}],
      ['get_ai_context_item', { id: 1 }],
      ['try_ai_reply', { message: 'Hi?' }],
      ['update_ai_setup', { target: 'instructions', text: 'x', reason: 'unknown agent' }],
      ['get_ai_setup_history', { target: 'instructions' }],
    ] as const) {
      const res = await call(tool, { ...args, agentId: 99 });
      expect(res.isError, tool).toBe(true);
      expect(res.text, tool).toMatch(/agent_not_found/);
    }
    expect(ai.agentStatus(sales).settings.instructions).toBe('Be concise.');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('keeps the version history per agent, with token id and agentId in the audit', async () => {
    await call('update_ai_setup', {
      target: 'instructions',
      text: 'Sales v2',
      reason: 'sales tuning',
    });
    await call('update_ai_setup', {
      agentId: helpdesk,
      target: 'instructions',
      text: 'Helpdesk v2',
      reason: 'helpdesk tuning',
    });
    const history = (
      await call('get_ai_setup_history', { agentId: helpdesk, target: 'instructions' })
    ).data();
    const previews = history.versions.map((v: { preview: string }) => v.preview);
    expect(previews[0]).toBe('Helpdesk v2');
    expect(previews).toContain('Answer clinic questions.');
    expect(previews.some((p: string) => p.startsWith('Sales') || p === 'Be concise.')).toBe(false);
    const defaultHistory = (await call('get_ai_setup_history', { target: 'instructions' })).data();
    expect(defaultHistory.versions[0].preview).toBe('Sales v2');
    // A version names its agent, so a revert goes back to the right one.
    const version = (
      await call('get_ai_setup_version', { versionId: history.versions[0].versionId })
    ).data();
    expect(version).toMatchObject({
      agentId: helpdesk,
      target: 'instructions',
      text: 'Helpdesk v2',
    });

    const metas = auditMetas('ai.member_update').filter((m) => m.via === 'mcp');
    expect(metas).toEqual([
      expect.objectContaining({ agentId: sales, tokenId, reason: 'sales tuning' }),
      expect.objectContaining({ agentId: helpdesk, tokenId, reason: 'helpdesk tuning' }),
    ]);
  });

  it('get_stats counts the messages of every AI agent', async () => {
    const now = Date.now();
    const chat = t.ctx.db.prepare(
      `INSERT INTO chats (jid, wa_jid, type, name, unread_count, status, updated_at, inbox_id)
       VALUES (?, ?, 'dm', ?, 0, 'open', 0, ?)`,
    );
    chat.run('a@s.whatsapp.net', 'a@s.whatsapp.net', 'A', 1);
    chat.run('b@s.whatsapp.net#2', 'b@s.whatsapp.net', 'B', 2);
    let seq = 0;
    const send = (chatJid: string, userId: number) =>
      t.ctx.db
        .prepare(
          `INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, status, timestamp, created_at)
           VALUES (?, ?, 1, ?, 'text', 'x', 'sent', ?, ?)`,
        )
        .run(`m${++seq}`, chatJid, userId, now, now);
    const userOf = (agentId: number) => ai.agentStatus(agentId).agent.userId;
    send('a@s.whatsapp.net', userOf(sales));
    send('b@s.whatsapp.net#2', userOf(helpdesk));
    send('b@s.whatsapp.net#2', userOf(helpdesk));
    send('a@s.whatsapp.net', admin.id);
    const all = (await call('get_stats', { days: 1 })).data();
    expect(all.ai.totals).toMatchObject({ chatsAnswered: 2, aiMessages: 3 });
    const two = (await call('get_stats', { days: 1, inboxId: 2 })).data();
    expect(two.ai.totals).toMatchObject({ chatsAnswered: 1, aiMessages: 2 });
  });
});

describe('MCP AI-setup tools before any agent exists', { timeout: 30_000 }, () => {
  beforeEach(() => {
    // A data dir that never saved an AI agent (cascades remove the agents' items).
    t.ctx.db.exec('DELETE FROM ai_setup_versions; DELETE FROM ai_agents');
  });

  it('shows the defaults, and the first change creates the inbox-1 agent only once', async () => {
    const setup = (await call('get_ai_agent_setup')).data();
    expect(setup).toMatchObject({ agentId: null, name: null, preset: 'sales', inboxId: null });
    expect(
      (await call('get_ai_setup_history', { target: 'instructions' })).data().versions,
    ).toEqual([]);

    const first = await call('update_ai_setup', {
      target: 'instructions',
      text: 'First words.',
      reason: 'first setup',
    });
    expect(first.isError).toBe(false);
    expect(first.data().versionId).toEqual(expect.any(Number));
    await call('update_ai_setup', { target: 'handoff_rules', text: '- Refunds', reason: 'again' });

    const agents = ai.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ inboxId: 1 });
    expect(ai.agentStatus(agents[0]!.id).settings).toMatchObject({
      instructions: 'First words.',
      handoffRules: '- Refunds',
    });
  });
});

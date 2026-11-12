import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { ToolSet } from 'ai';
import type { AskEzyAnswer, AskEzyBlock, AskEzyEvent, User } from '@ezychat/shared';
import type { AiAssistCall, AiProvider } from '../src/ai/provider-types.js';
import type { AssistOutput } from '../src/ai/agent/assist.js';
import { createAiService } from '../src/ai/service.js';
import { agentById, listAgents } from '../src/ai/agents.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { HttpError } from '../src/http/errors.js';
import { chatEnding, createSetupStore } from '../src/ask-ezy/setup.js';
import { ProposeError } from '../src/ask-ezy/changes.js';
import { ScheduledTaskBody } from '@ezychat/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const JEE = '60123450084@s.whatsapp.net';
const JEE_LIM = '60198765521@s.whatsapp.net';
const SUPPLIER = '120363000000000001@g.us';
const INSTRUCTION = 'Greet Jee Fong warmly and wish a good day. One or two short sentences.';
const PREVIEW = 'Good morning Jee Fong! Wishing you a great day ahead.';

type Script = (tools: ToolSet) => Promise<AssistOutput>;

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

const exec = async (tools: ToolSet, name: string, args: object) => {
  const fn = tools[name]?.execute;
  if (!fn) throw new Error(`no tool ${name}`);
  return (await (fn as (input: object, options: object) => Promise<unknown>)(args, {
    toolCallId: name,
    messages: [],
    context: {},
  })) as Record<string, unknown>;
};

/** Lite: one inbox, one agent ("Aina"). `several`: 3 inboxes allowed (so 3 agents), 2 exist. */
async function setup(opts: { several?: boolean; noAgent?: boolean } = {}) {
  let script: Script = async () => ({ text: 'Hello', blocks: [], followUps: [] });
  const logLines: string[] = [];
  const provider: AiProvider = {
    generate: vi.fn(),
    assist: vi.fn(async (_settings, _key, call: AiAssistCall) => {
      const output = await script(call.tools);
      return { output, toolCalls: [], steps: 1, model: 'gpt-test' };
    }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  const t = await makeTestApp({
    ...(opts.several ? { maxInboxes: 3, inboxes: 2 } : {}),
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.ai = createAiService(ctx, { provider, isOnline: () => true });
      const capture = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
      const child = ctx.log.child.bind(ctx.log);
      vi.spyOn(ctx.log, 'child').mockImplementation(((bindings: Record<string, unknown>) =>
        bindings.mod === 'ask-ezy' ? capture.child(bindings) : child(bindings)) as never);
    },
  });
  open.push(t);
  const auth = t.ctx.services.auth!;
  const makeUser = (username: string, role: 'admin' | 'agent') =>
    auth.createUser({
      username,
      displayName: username,
      role,
      password: 'password123',
      mustChangePassword: false,
    });
  const admin = makeUser('admin', 'admin');
  const member = makeUser('member', 'agent');
  const cookie = (id: number) =>
    `sid=${auth.createSession(id, { ip: '127.0.0.1', userAgent: 't' })}`;
  const ai = t.ctx.services.ai!;
  const actor = { userId: admin.id, ip: null };
  ai.saveConnection({ mode: 'chatgpt', model: '' }, actor);
  if (!opts.noAgent)
    ai.saveMember({ displayName: 'Aina', enabled: false, instructions: 'Be kind.' }, actor);
  const scheduledTurn = vi.spyOn(ai, 'scheduledTurn').mockResolvedValue({
    outcome: 'send',
    text: PREVIEW,
    reason: null,
    lookups: [],
  } as never);
  const chats = getChats(t.ctx);
  chats.upsertFromWa({ jid: JEE, type: 'dm', name: 'Jee Fong' }, 1);
  chats.upsertFromWa({ jid: JEE_LIM, type: 'dm', name: 'Jee Fong Lim' }, 1);
  if (opts.several) {
    t.ctx.inboxes.repo.rename(2, 'Anchor SG');
    chats.upsertFromWa({ jid: SUPPLIER, type: 'group', name: 'Supplier KL' }, 2);
  }
  const agentId = opts.noAgent ? 0 : listAgents(t.ctx.db)[0]!.id;
  return {
    t,
    admin,
    member,
    actor,
    agentId,
    logLines,
    scheduledTurn,
    adminCookie: cookie(admin.id),
    memberCookie: cookie(member.id),
    setScript: (s: Script) => (script = s),
  };
}

const ask = async (t: TestApp, cookie: string, question = 'Greet Jee Fong at 9am every day') => {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/ask-ezy',
    headers: authHeaders(cookie),
    payload: { question },
  });
  expect(res.statusCode, res.body).toBe(200);
  const events = res.payload
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AskEzyEvent);
  const last = events.at(-1);
  if (last?.type !== 'answer') throw new Error(`no answer: ${JSON.stringify(last)}`);
  return last.answer;
};
const act = (t: TestApp, cookie: string, id: string, action: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/ask-ezy/changes/${id}/${action}`,
    headers: authHeaders(cookie),
  });
const blockOf = <T extends AskEzyBlock['type']>(answer: AskEzyAnswer, type: T) =>
  answer.blocks.find((b) => b.type === type) as Extract<AskEzyBlock, { type: T }> | undefined;
const json = (value: object) => JSON.stringify(value);
const taskCount = (t: TestApp) =>
  (t.ctx.db.prepare('SELECT count(*) AS n FROM ai_scheduled_tasks').get() as { n: number }).n;

/** The fake model's usual plan: look the chat up, then propose a task for an agent (or a pending one). */
async function proposeTask(
  tools: ToolSet,
  agent: { agentId: number } | { agentProposalId: string },
  over: Record<string, unknown> = {},
) {
  await exec(tools, 'list_chats', { query: 'Jee Fong' });
  return exec(tools, 'propose_scheduled_task', {
    ...agent,
    chatJid: JEE,
    name: 'Morning greeting',
    time: '09:00',
    dayRule: 'daily',
    instruction: INSTRUCTION,
    ...over,
  });
}

describe('Ask Ezy question block', () => {
  it('keeps a question with at most 4 short choices and drops one without choices', async () => {
    const s = await setup();
    s.setScript(async () => ({
      text: 'I can do that with a scheduled task.',
      blocks: [
        {
          type: 'question',
          json: json({
            text: 'Should a new agent send it, or your Sales Agent?',
            choices: ['New agent', 'Sales Agent', 'c', 'd', 'e', '', 'x'.repeat(200)],
            note: 'EzyChat Lite has one AI agent.',
            tone: 'warning',
          }),
        },
        { type: 'question', json: json({ text: 'Which one?', choices: [] }) },
      ],
      followUps: [],
    }));
    const answer = await ask(s.t, s.adminCookie);
    expect(answer.blocks).toEqual([
      {
        type: 'question',
        text: 'Should a new agent send it, or your Sales Agent?',
        choices: ['New agent', 'Sales Agent', 'c', 'd'],
        note: 'EzyChat Lite has one AI agent.',
        tone: 'warning',
      },
    ]);
  });
});

describe('Ask Ezy sets up scheduled tasks (Lite)', () => {
  it('gives team members none of the setup tools and no setup cards', async () => {
    const s = await setup();
    let names: string[] = [];
    s.setScript(async (tools) => {
      names = Object.keys(tools);
      return {
        text: 'Ask your admin.',
        blocks: [{ type: 'agent_proposal', json: json({ id: 'x' }) }],
        followUps: [],
      };
    });
    const answer = await ask(s.t, s.memberCookie);
    for (const name of [
      'list_scheduled_tasks',
      'propose_agent',
      'propose_scheduled_task',
      'propose_scheduled_task_edit',
    ])
      expect(names).not.toContain(name);
    expect(answer.blocks).toEqual([]);
    // Members cannot apply anything either.
    expect((await act(s.t, s.memberCookie, 'x', 'apply')).statusCode).toBe(403);
  });

  it('refuses a new agent at the Lite limit with the Lite text', async () => {
    const s = await setup();
    let result: Record<string, unknown> = {};
    s.setScript(async (tools) => {
      result = await exec(tools, 'propose_agent', {
        name: 'Morning greeter',
        preset: 'custom',
        purpose: 'Sends the morning greeting.',
      });
      return { text: 'Lite has one agent.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie);
    expect(String(result.error)).toContain('agent_limit');
    expect(String(result.error)).toContain(
      "EzyChat Lite has one AI agent, so I can't add a new one.",
    );
  });

  it('proposes a task with a preview that sends nothing, applies it and undoes it', async () => {
    const s = await setup();
    let proposed: Record<string, unknown> = {};
    s.setScript(async (tools) => {
      proposed = await proposeTask(tools, { agentId: s.agentId });
      return {
        text: 'Here is the plan.',
        blocks: [{ type: 'task_proposal', json: json({ id: proposed.proposalId }) }],
        followUps: [],
      };
    });
    const answer = await ask(s.t, s.adminCookie);
    expect(proposed).toMatchObject({ saved: false, preview: true });
    const card = blockOf(answer, 'task_proposal')!;
    expect(card).toMatchObject({
      agent: 'Aina',
      agentId: s.agentId,
      dependsOn: null,
      name: 'Morning greeting',
      time: '09:00',
      dayRule: 'daily',
      days: [],
      chatName: 'Jee Fong',
      chatEnding: '0084',
      chatType: 'dm',
      instruction: INSTRUCTION,
      timeZone: 'Asia/Kuala_Lumpur',
      preview: PREVIEW,
      before: null,
      status: 'proposed',
    });
    // The preview ran one scheduled turn in preview mode: nothing sent, nothing stored.
    expect(s.scheduledTurn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: s.agentId, chatJid: JEE, preview: true }),
      expect.anything(),
    );
    expect(getMessages(s.t.ctx).list(JEE, { limit: 10 }).messages).toEqual([]);
    expect(taskCount(s.t)).toBe(0);

    const applied = await act(s.t, s.adminCookie, card.id, 'apply');
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({
      status: 'applied',
      agentId: s.agentId,
      agentOn: false,
      related: [],
    });
    expect(applied.json().nextRunAt).toEqual(expect.any(Number));
    const task = s.t.ctx.services.scheduled!.list(s.agentId).tasks[0]!;
    expect(task).toMatchObject({ name: 'Morning greeting', time: '09:00', chatJid: JEE });
    // A second Apply changes nothing.
    expect((await act(s.t, s.adminCookie, card.id, 'apply')).json()).toMatchObject({
      status: 'applied',
      taskId: task.id,
    });
    const audit = s.t.ctx.db
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'scheduled_task.%'")
      .all() as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain('scheduled_task.create');

    const undone = await act(s.t, s.adminCookie, card.id, 'undo');
    expect(undone.json()).toMatchObject({ status: 'proposed' });
    expect(taskCount(s.t)).toBe(0);

    // Logs keep kinds and ids: never the instruction, the preview or the chat's name.
    const logs = s.logLines.join('\n');
    expect(logs).toContain('ask_ezy_setup');
    expect(logs).not.toContain(INSTRUCTION);
    expect(logs).not.toContain(PREVIEW);
    expect(logs).not.toContain('Jee Fong');
  });

  it('only uses a chat a look-up of this answer returned', async () => {
    const s = await setup();
    const results: Record<string, unknown>[] = [];
    s.setScript(async (tools) => {
      // A made-up key, and a real one never looked up.
      for (const chatJid of ['60999999999@s.whatsapp.net', JEE])
        results.push(
          await exec(tools, 'propose_scheduled_task', {
            agentId: s.agentId,
            chatJid,
            name: 'Morning greeting',
            time: '09:00',
            dayRule: 'daily',
            instruction: INSTRUCTION,
          }),
        );
      results.push(await proposeTask(tools, { agentId: 999 }));
      results.push(await proposeTask(tools, { agentId: s.agentId, agentProposalId: 'x' }));
      results.push(await proposeTask(tools, { agentId: s.agentId }, { dayRule: 'custom' }));
      return { text: 'Which chat?', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie);
    expect(String(results[0]!.error)).toContain('look the chat up first');
    expect(String(results[1]!.error)).toContain('look the chat up first');
    expect(String(results[2]!.error)).toContain('Unknown agentId');
    expect(String(results[3]!.error)).toContain('either agentId');
    expect(String(results[4]!.error)).toContain('Choose at least one day');
  });

  it('proposes an edit with the saved values, applies, refuses a stale undo, and undoes', async () => {
    const s = await setup();
    const scheduled = s.t.ctx.services.scheduled!;
    const task = scheduled.create(
      s.agentId,
      ScheduledTaskBody.parse({
        name: 'Morning greeting',
        time: '09:00',
        dayRule: 'daily',
        chatJid: JEE,
        instruction: INSTRUCTION,
      }),
      s.actor,
    );
    let listed: Record<string, unknown> = {};
    let same: Record<string, unknown> = {};
    s.setScript(async (tools) => {
      listed = await exec(tools, 'list_scheduled_tasks', {});
      same = await exec(tools, 'propose_scheduled_task_edit', { taskId: task.id, time: '09:00' });
      const edit = await exec(tools, 'propose_scheduled_task_edit', {
        taskId: task.id,
        time: '08:30',
      });
      return {
        text: 'Move it to 08:30?',
        blocks: [{ type: 'task_proposal', json: json({ id: edit.proposalId }) }],
        followUps: [],
      };
    });
    const answer = await ask(s.t, s.adminCookie, "Move Jee Fong's greeting to 8:30");
    expect(listed).toMatchObject({
      tasks: [
        {
          taskId: task.id,
          agentName: 'Aina',
          time: '09:00',
          chatJid: JEE,
          chatName: 'Jee Fong',
          chatEnding: '0084',
        },
      ],
    });
    expect(String(same.error)).toContain('Nothing changes');
    const card = blockOf(answer, 'task_proposal')!;
    expect(card).toMatchObject({ time: '08:30', before: { time: '09:00' }, taskId: task.id });
    // Only the time changed: no preview was asked for.
    expect(card.preview).toBeNull();

    expect((await act(s.t, s.adminCookie, card.id, 'apply')).json()).toMatchObject({
      status: 'applied',
      taskId: task.id,
    });
    expect(scheduled.list(s.agentId).tasks[0]!.time).toBe('08:30');

    // Someone changed the task on its page: Undo never overwrites that.
    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ['Date'] });
    scheduled.update(s.agentId, task.id, { name: 'Hello' }, s.actor);
    vi.useRealTimers();
    expect((await act(s.t, s.adminCookie, card.id, 'undo')).statusCode).toBe(409);
    scheduled.update(s.agentId, task.id, { name: 'Morning greeting' }, s.actor);
  });

  it('undoes an applied edit back to the saved time', async () => {
    const s = await setup();
    const scheduled = s.t.ctx.services.scheduled!;
    const task = scheduled.create(
      s.agentId,
      ScheduledTaskBody.parse({
        name: 'Greeting',
        time: '09:00',
        dayRule: 'custom',
        days: [1, 3],
        chatJid: JEE,
        instruction: INSTRUCTION,
      }),
      s.actor,
    );
    let id = '';
    s.setScript(async (tools) => {
      await exec(tools, 'list_chats', { query: 'Jee Fong' });
      const edit = await exec(tools, 'propose_scheduled_task_edit', {
        taskId: task.id,
        days: [5],
        chatJid: JEE_LIM,
      });
      id = String(edit.proposalId);
      return {
        text: 'Change it?',
        blocks: [{ type: 'task_proposal', json: json({ id }) }],
        followUps: [],
      };
    });
    const card = blockOf(await ask(s.t, s.adminCookie), 'task_proposal')!;
    expect(card).toMatchObject({
      dayRule: 'custom',
      days: [5],
      chatName: 'Jee Fong Lim',
      chatEnding: '5521',
      before: { dayRule: 'custom', days: [1, 3], chatName: 'Jee Fong', chatEnding: '0084' },
      preview: PREVIEW,
    });
    expect((await act(s.t, s.adminCookie, id, 'apply')).statusCode).toBe(200);
    expect(scheduled.list(s.agentId).tasks[0]).toMatchObject({ days: [5], chatJid: JEE_LIM });
    expect((await act(s.t, s.adminCookie, id, 'undo')).json()).toMatchObject({
      status: 'proposed',
    });
    expect(scheduled.list(s.agentId).tasks[0]).toMatchObject({ days: [1, 3], chatJid: JEE });
    // A stale edit (the task moved since Ezy read it) is never applied.
    scheduled.update(s.agentId, task.id, { time: '10:00' }, s.actor);
    const stale = await act(s.t, s.adminCookie, id, 'apply');
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('setup_changed');
  });

  it('refuses a new agent on Apply once the Lite limit is reached (409 agent_limit)', async () => {
    const s = await setup({ noAgent: true });
    let id = '';
    s.setScript(async (tools) => {
      const r = await exec(tools, 'propose_agent', {
        name: 'Morning greeter',
        preset: 'custom',
        purpose: 'Sends the morning greeting.',
      });
      id = String(r.proposalId);
      return {
        text: 'Here is the plan.',
        blocks: [{ type: 'agent_proposal', json: json({ id }) }],
        followUps: [],
      };
    });
    const answer = await ask(s.t, s.adminCookie);
    expect(blockOf(answer, 'agent_proposal')).toMatchObject({
      name: 'Morning greeter',
      preset: 'custom',
      inboxName: expect.any(String),
      note: 'Sends the morning greeting.',
      status: 'proposed',
    });
    // Meanwhile the one agent Lite allows was made on the agent page.
    s.t.ctx.services.ai!.saveMember(
      { displayName: 'Aina', enabled: false, instructions: '' },
      s.actor,
    );
    const res = await act(s.t, s.adminCookie, id, 'apply');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('agent_limit');
    expect(listAgents(s.t.ctx.db)).toHaveLength(1);
  });
});

describe('Ask Ezy sets up agents (several numbers)', { timeout: 30_000 }, () => {
  async function bothProposed(s: Awaited<ReturnType<typeof setup>>) {
    let agentPid = '';
    let taskPid = '';
    s.setScript(async (tools) => {
      const agent = await exec(tools, 'propose_agent', {
        name: 'Morning greeter',
        preset: 'custom',
        inboxId: 1,
        purpose: 'Sends scheduled messages only.',
      });
      agentPid = String(agent.proposalId);
      const task = await proposeTask(tools, { agentProposalId: agentPid });
      taskPid = String(task.proposalId);
      return {
        text: 'Here is the plan.',
        blocks: [
          { type: 'agent_proposal', json: json({ id: agentPid }) },
          { type: 'task_proposal', json: json({ id: taskPid }) },
        ],
        followUps: [],
      };
    });
    const answer = await ask(s.t, s.adminCookie);
    return { answer, agentPid, taskPid };
  }

  it('applies both: the agent first (switched off), then its task; Undo removes both', async () => {
    const s = await setup({ several: true });
    const { answer, agentPid, taskPid } = await bothProposed(s);
    expect(blockOf(answer, 'task_proposal')).toMatchObject({
      agent: 'Morning greeter',
      agentId: null,
      dependsOn: agentPid,
      // No agent yet: no preview.
      preview: null,
    });
    expect(listAgents(s.t.ctx.db)).toHaveLength(1);

    const res = await act(s.t, s.adminCookie, taskPid, 'apply');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'applied',
      related: [{ id: agentPid, status: 'applied' }],
      agentOn: false,
    });
    const agent = agentById(s.t.ctx.db, body.agentId)!;
    expect(agent).toMatchObject({ enabled: false, inboxId: 1, preset: 'custom' });
    expect(s.t.ctx.services.scheduled!.list(agent.id).tasks).toHaveLength(1);
    const actions = (
      s.t.ctx.db.prepare('SELECT action FROM audit_log').all() as Array<{ action: string }>
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['ai.agent_create', 'scheduled_task.create']));
    // The agent card now shows applied.
    expect((await act(s.t, s.adminCookie, agentPid, 'apply')).json()).toMatchObject({
      status: 'applied',
      agentId: agent.id,
    });
    // The agent has a task: its own Undo refuses.
    expect((await act(s.t, s.adminCookie, agentPid, 'undo')).json().error.code).toBe(
      'agent_in_use',
    );

    const undone = await act(s.t, s.adminCookie, taskPid, 'undo');
    expect(undone.json()).toMatchObject({
      status: 'proposed',
      related: [{ id: agentPid, status: 'proposed' }],
    });
    expect(taskCount(s.t)).toBe(0);
    expect(agentById(s.t.ctx.db, agent.id)).toBeNull();
  });

  it('keeps the new agent and says why when its task cannot be saved', async () => {
    const s = await setup({ several: true });
    const { agentPid, taskPid } = await bothProposed(s);
    vi.spyOn(s.t.ctx.services.scheduled!, 'create').mockImplementationOnce(() => {
      throw new HttpError(409, 'scheduled_task_limit', 'An agent can have at most 10');
    });
    const res = await act(s.t, s.adminCookie, taskPid, 'apply');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'proposed',
      related: [{ id: agentPid, status: 'applied' }],
      failed: { code: 'scheduled_task_limit' },
    });
    expect(listAgents(s.t.ctx.db)).toHaveLength(2);
    expect(taskCount(s.t)).toBe(0);
    // Apply again: the agent is reused, the task is saved.
    expect((await act(s.t, s.adminCookie, taskPid, 'apply')).json()).toMatchObject({
      status: 'applied',
    });
    expect(listAgents(s.t.ctx.db)).toHaveLength(2);
  });

  it('never applies a task whose new agent was discarded; the agent alone undoes cleanly', async () => {
    const s = await setup({ several: true });
    const { agentPid, taskPid } = await bothProposed(s);
    expect((await act(s.t, s.adminCookie, agentPid, 'discard')).json()).toMatchObject({
      status: 'discarded',
    });
    const refused = await act(s.t, s.adminCookie, taskPid, 'apply');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('agent_discarded');
    // Show it again, apply the agent alone, then undo it (off, no chats, no tasks).
    expect((await act(s.t, s.adminCookie, agentPid, 'undo')).json().status).toBe('proposed');
    const applied = await act(s.t, s.adminCookie, agentPid, 'apply');
    expect(applied.json()).toMatchObject({ status: 'applied', agentOn: false });
    expect(listAgents(s.t.ctx.db)).toHaveLength(2);
    expect((await act(s.t, s.adminCookie, agentPid, 'discard')).statusCode).toBe(409);
    expect((await act(s.t, s.adminCookie, agentPid, 'undo')).json().status).toBe('proposed');
    expect(listAgents(s.t.ctx.db)).toHaveLength(1);
    expect((await act(s.t, s.adminCookie, 'gone', 'apply')).statusCode).toBe(404);
  });

  it('refuses a chat on another number and asks for the number of a new agent', async () => {
    const s = await setup({ several: true });
    const results: Record<string, unknown>[] = [];
    s.setScript(async (tools) => {
      await exec(tools, 'list_chats', { query: 'Supplier' });
      results.push(
        await exec(tools, 'propose_scheduled_task', {
          agentId: s.agentId,
          chatJid: `${SUPPLIER}#2`,
          name: 'Supplier greeting',
          time: '09:00',
          dayRule: 'weekdays',
          instruction: 'Greet the suppliers.',
        }),
      );
      results.push(
        await exec(tools, 'propose_agent', {
          name: 'Greeter',
          preset: 'custom',
          purpose: 'Greets.',
        }),
      );
      results.push(
        await exec(tools, 'propose_agent', {
          name: 'Greeter',
          preset: 'custom',
          inboxId: 9,
          purpose: 'Greets.',
        }),
      );
      return { text: 'That group is on another number.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie);
    expect(String(results[0]!.error)).toContain('chat_not_in_inbox');
    expect(String(results[0]!.error)).toContain('Anchor SG');
    expect(String(results[1]!.error)).toContain('Give inboxId');
    expect(String(results[2]!.error)).toContain('No WhatsApp number 9');
    expect(taskCount(s.t)).toBe(0);
  });

  it('checks chat access in the store itself (a member limited to one inbox)', async () => {
    const s = await setup({ several: true });
    const store = createSetupStore(s.t.ctx);
    const member = { ...s.member, role: 'agent' } as User;
    await expect(
      store.proposeTask(
        member,
        {
          agentId: s.agentId,
          chatJid: `${SUPPLIER}#2`,
          name: 'x',
          time: '09:00',
          dayRule: 'daily',
          instruction: 'x',
        },
        new Set([`${SUPPLIER}#2`]),
      ),
    ).rejects.toThrow(ProposeError);
    expect(chatEnding({ type: 'group', phone: '601', waJid: SUPPLIER })).toBeNull();
    expect(chatEnding({ type: 'dm', phone: null, waJid: '12@lid' })).toBeNull();
    expect(chatEnding({ type: 'dm', phone: '+60 12-345 0084', waJid: JEE })).toBe('0084');
  });
});

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
import { ASK_EZY_PREVIEWS_PER_MINUTE, chatEnding, createSetupStore } from '../src/ask-ezy/setup.js';
import { ProposeError } from '../src/ask-ezy/changes.js';
import { AskEzyRequest, ScheduledTaskBody, presetTexts } from '@ezychat/shared';
import { createAskEzyService } from '../src/ask-ezy/service.js';
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

/**
 * Lite: one inbox, one agent ("Aina"). `several`: 3 inboxes allowed (so 3 agents), 2 exist. The fake model's
 * fast turn calls `start_setup` when it is offered (as a real model does for a setup request), so `script`
 * runs on the main-model setup turn; `fastOnly` keeps every script on the fast turn.
 */
async function setup(opts: { several?: boolean; noAgent?: boolean; fastOnly?: boolean } = {}) {
  let script: Script = async () => ({ text: 'Hello', blocks: [], followUps: [] });
  const logLines: string[] = [];
  const calls: AiAssistCall[] = [];
  const provider: AiProvider = {
    generate: vi.fn(),
    assist: vi.fn(async (_settings, _key, call: AiAssistCall) => {
      calls.push(call);
      if (!opts.fastOnly && !call.main && call.tools.start_setup) {
        await exec(call.tools, 'start_setup', {});
        return {
          output: { text: 'Setting up…', blocks: [], followUps: [] },
          toolCalls: ['start_setup'],
          steps: 1,
          model: 'gpt-fast',
        };
      }
      const output = await script(call.tools);
      return { output, toolCalls: [], steps: 1, model: call.main ? 'gpt-main' : 'gpt-fast' };
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
    calls,
    provider,
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
  it('logs an unexpected tool failure by its error class only, and tells the model a fixed text', async () => {
    const s = await setup();
    let result: Record<string, unknown> = {};
    s.setScript(async (tools) => {
      // A model that skipped the input check: no taskId (a ZodError inside the tool).
      result = await exec(tools, 'propose_scheduled_task_edit', { time: '08:30' });
      return { text: 'Could not change it.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie, 'Move it to 8:30');
    expect(result.error).toBe('The tool failed. Try another way or answer with what you have.');
    const line = s.logLines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === 'Ask Ezy tool failed');
    expect(line).toMatchObject({ tool: 'propose_scheduled_task_edit', errName: 'ZodError' });
    expect(JSON.stringify(line)).not.toContain('08:30');
  });

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
    const { answer, taskPid } = await bothProposed(s, null);
    expect(blockOf(answer, 'agent_proposal')).toMatchObject({
      name: 'Morning greeter',
      preset: 'custom',
      inboxName: expect.any(String),
      note: 'Sends scheduled messages only.',
      status: 'proposed',
    });
    // Meanwhile the one agent Lite allows was made on the agent page.
    s.t.ctx.services.ai!.saveMember(
      { displayName: 'Aina', enabled: false, instructions: '' },
      s.actor,
    );
    const res = await act(s.t, s.adminCookie, taskPid, 'apply');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('agent_limit');
    expect(listAgents(s.t.ctx.db)).toHaveLength(1);
    expect(taskCount(s.t)).toBe(0);
  });
});

/** A new agent and its task in one answer (the model's plan for "a new agent that greets Jee Fong"). */
async function bothProposed(s: Awaited<ReturnType<typeof setup>>, inboxId: number | null = 1) {
  let agentPid = '';
  let taskPid = '';
  s.setScript(async (tools) => {
    const agent = await exec(tools, 'propose_agent', {
      name: 'Morning greeter',
      ...(inboxId ? { inboxId } : {}),
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

describe('Ask Ezy sets up agents (several numbers)', { timeout: 30_000 }, () => {
  it('applies both: the agent first (switched off), then its task; Undo removes both', async () => {
    const s = await setup({ several: true });
    const { answer, agentPid, taskPid } = await bothProposed(s);
    expect(blockOf(answer, 'task_proposal')).toMatchObject({
      agent: 'Morning greeter',
      agentId: null,
      dependsOn: agentPid,
      // A preview from the unsaved agent: nothing created, nothing sent.
      preview: PREVIEW,
    });
    expect(s.scheduledTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: null,
        chatJid: JEE,
        preview: true,
        draft: {
          name: 'Morning greeter',
          preset: 'custom',
          instructions: expect.stringContaining('Sends scheduled messages only.'),
        },
      }),
      expect.any(AbortSignal),
    );
    expect(blockOf(answer, 'agent_proposal')).toMatchObject({ removable: true });
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

  it('never applies a task whose new agent was discarded, nor a new agent without its task', async () => {
    const s = await setup({ several: true });
    const { agentPid, taskPid } = await bothProposed(s);
    expect((await act(s.t, s.adminCookie, agentPid, 'discard')).json()).toMatchObject({
      status: 'discarded',
    });
    const refused = await act(s.t, s.adminCookie, taskPid, 'apply');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('agent_discarded');
    // Shown again, the agent still applies only with its task.
    expect((await act(s.t, s.adminCookie, agentPid, 'undo')).json().status).toBe('proposed');
    const alone = await act(s.t, s.adminCookie, agentPid, 'apply');
    expect(alone.statusCode).toBe(409);
    expect(alone.json().error.code).toBe('agent_needs_task');
    expect(listAgents(s.t.ctx.db)).toHaveLength(1);
    expect((await act(s.t, s.adminCookie, taskPid, 'apply')).json().status).toBe('applied');
    expect((await act(s.t, s.adminCookie, agentPid, 'discard')).statusCode).toBe(409);
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
          purpose: 'Greets.',
        }),
      );
      results.push(
        await exec(tools, 'propose_agent', {
          name: 'Greeter',
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

describe('Ask Ezy setup: review fixes', { timeout: 30_000 }, () => {
  const NONAME = '60111116789@s.whatsapp.net';
  const later = (ms = 60_000) => vi.useFakeTimers({ now: Date.now() + ms, toFake: ['Date'] });

  async function appliedTask(s: Awaited<ReturnType<typeof setup>>) {
    let id = '';
    s.setScript(async (tools) => {
      id = String((await proposeTask(tools, { agentId: s.agentId })).proposalId);
      return { text: 'Plan.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie);
    expect((await act(s.t, s.adminCookie, id, 'apply')).statusCode).toBe(200);
    return id;
  }

  it('never undoes a new task someone changed on the agent page since Apply', async () => {
    const s = await setup();
    const id = await appliedTask(s);
    const scheduled = s.t.ctx.services.scheduled!;
    const task = scheduled.list(s.agentId).tasks[0]!;
    later();
    scheduled.update(s.agentId, task.id, { time: '10:00' }, s.actor);
    vi.useRealTimers();
    const res = await act(s.t, s.adminCookie, id, 'undo');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('setup_changed');
    expect(scheduled.list(s.agentId).tasks).toHaveLength(1);
  });

  it('never removes a new agent the admin filled in since Apply', async () => {
    const s = await setup({ several: true });
    const { agentPid, taskPid } = await bothProposed(s);
    const applied = (await act(s.t, s.adminCookie, taskPid, 'apply')).json();
    s.t.ctx.services.ai!.addText(
      applied.agentId,
      { name: 'Opening hours', text: 'We open at 9.' },
      s.actor,
    );
    // The task's Undo removes the task; the filled-in agent stays.
    expect((await act(s.t, s.adminCookie, taskPid, 'undo')).json()).toMatchObject({
      status: 'proposed',
      related: [{ id: agentPid, status: 'applied' }],
    });
    const res = await act(s.t, s.adminCookie, agentPid, 'undo');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('setup_changed');
    expect(agentById(s.t.ctx.db, applied.agentId)).not.toBeNull();
  });

  it('after "Apply both" made only the agent: its Undo discards the task', async () => {
    const s = await setup({ several: true });
    const { agentPid, taskPid } = await bothProposed(s);
    vi.spyOn(s.t.ctx.services.scheduled!, 'create').mockImplementationOnce(() => {
      throw new HttpError(409, 'scheduled_task_limit', 'An agent can have at most 10');
    });
    const failed = (await act(s.t, s.adminCookie, taskPid, 'apply')).json();
    expect(failed.failed.code).toBe('scheduled_task_limit');
    const undone = await act(s.t, s.adminCookie, agentPid, 'undo');
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({
      status: 'proposed',
      related: [{ id: taskPid, status: 'discarded' }],
    });
    expect(agentById(s.t.ctx.db, failed.agentId)).toBeNull();
    expect(taskCount(s.t)).toBe(0);
  });

  it('refuses a retried task Apply when its new agent was removed meanwhile', async () => {
    const s = await setup({ several: true });
    const { taskPid } = await bothProposed(s);
    vi.spyOn(s.t.ctx.services.scheduled!, 'create').mockImplementationOnce(() => {
      throw new HttpError(409, 'scheduled_task_limit', 'An agent can have at most 10');
    });
    const failed = (await act(s.t, s.adminCookie, taskPid, 'apply')).json();
    s.t.ctx.services.ai!.deleteAgent(failed.agentId, s.actor);
    const retry = await act(s.t, s.adminCookie, taskPid, 'apply');
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('agent_gone');
    expect(taskCount(s.t)).toBe(0);
  });

  it("passes Ask Ezy's abort signal to the preview and keeps its own preview limit", async () => {
    const s = await setup();
    const store = createSetupStore(s.t.ctx);
    const input = {
      agentId: s.agentId,
      chatJid: JEE,
      name: 'Greeting',
      time: '09:00',
      dayRule: 'daily' as const,
      instruction: INSTRUCTION,
    };
    // A preview that waits: stopping the Ask Ezy request stops it (no budget hit, no preview).
    s.scheduledTurn.mockImplementationOnce(
      (_input, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ) as never,
    );
    const stop = new AbortController();
    const pending = store.proposeTask(s.admin, input, new Set([JEE]), stop.signal);
    await vi.waitFor(() => expect(s.scheduledTurn).toHaveBeenCalledTimes(1));
    stop.abort();
    expect(await pending).toMatchObject({ preview: null });
    expect((await pending).previewTimedOut).toBeUndefined();
    for (let i = 1; i < ASK_EZY_PREVIEWS_PER_MINUTE; i++)
      await store.proposeTask(s.admin, input, new Set([JEE]));
    const over = await store.proposeTask(s.admin, input, new Set([JEE]));
    expect(over.preview).toBeNull();
    expect(s.scheduledTurn).toHaveBeenCalledTimes(ASK_EZY_PREVIEWS_PER_MINUTE);
    // The agent page's own preview limit is untouched.
    const page = await s.t.ctx.services.scheduled!.preview(
      s.agentId,
      { chatJid: JEE, instruction: INSTRUCTION },
      s.actor,
    );
    expect(page.result).toBe('sent');
  });

  it('keeps a question whose choices are clipped inside emoji', async () => {
    const s = await setup();
    s.setScript(async () => ({
      text: 'Which one?',
      blocks: [
        { type: 'question', json: json({ text: 'Which one?', choices: ['😀'.repeat(100), 'b'] }) },
      ],
      followUps: [],
    }));
    const question = blockOf(await ask(s.t, s.adminCookie), 'question')!;
    expect(question.choices).toHaveLength(2);
    expect(question.choices[0]!.length).toBeLessThanOrEqual(80);
    expect(question.choices[0]!.endsWith('…')).toBe(true);
  });

  it('never shows a full phone number as a chat name', async () => {
    const s = await setup();
    getChats(s.t.ctx).upsertFromWa({ jid: NONAME, type: 'dm', name: null }, 1);
    let listed: Record<string, unknown> = {};
    let id = '';
    s.setScript(async (tools) => {
      await exec(tools, 'list_chats', { query: '6789' });
      const p = await exec(tools, 'propose_scheduled_task', {
        agentId: s.agentId,
        chatJid: NONAME,
        name: 'Greeting',
        time: '09:00',
        dayRule: 'daily',
        instruction: INSTRUCTION,
      });
      id = String(p.proposalId);
      return {
        text: 'Plan.',
        blocks: [{ type: 'task_proposal', json: json({ id }) }],
        followUps: [],
      };
    });
    const card = blockOf(await ask(s.t, s.adminCookie), 'task_proposal')!;
    expect(card).toMatchObject({ chatName: null, chatEnding: '6789' });
    expect(JSON.stringify(card)).not.toContain('60111116789');
    expect((await act(s.t, s.adminCookie, id, 'apply')).statusCode).toBe(200);
    s.setScript(async (tools) => {
      listed = await exec(tools, 'list_scheduled_tasks', {});
      return { text: 'Tasks.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie);
    expect(JSON.stringify(listed)).toContain('Chat …6789');
    expect(JSON.stringify(listed)).not.toContain('"chatName":"60111116789"');
  });

  it('reports whether a new agent is on, also on a repeated Apply', async () => {
    const s = await setup({ noAgent: true });
    const { agentPid, taskPid } = await bothProposed(s, null);
    const first = (await act(s.t, s.adminCookie, taskPid, 'apply')).json();
    expect(first.agentOn).toBe(false);
    const agent = agentById(s.t.ctx.db, first.agentId)!;
    s.t.ctx.db.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(agent.userId);
    expect((await act(s.t, s.adminCookie, agentPid, 'apply')).json().agentOn).toBe(true);
  });

  it('in Lite, Undo removes the task and the new agent stays, switched off', async () => {
    const s = await setup({ noAgent: true });
    const { answer, agentPid, taskPid } = await bothProposed(s, null);
    expect(blockOf(answer, 'agent_proposal')).toMatchObject({ removable: false });
    const applied = (await act(s.t, s.adminCookie, taskPid, 'apply')).json();
    expect(applied.status).toBe('applied');
    const undone = await act(s.t, s.adminCookie, taskPid, 'undo');
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({
      status: 'proposed',
      related: [{ id: agentPid, status: 'applied' }],
    });
    expect(taskCount(s.t)).toBe(0);
    expect(agentById(s.t.ctx.db, applied.agentId)).toMatchObject({ enabled: false });
    const kept = await act(s.t, s.adminCookie, agentPid, 'undo');
    expect(kept.statusCode).toBe(409);
    expect(kept.json().error.code).toBe('agent_kept');
  });

  it('never drops a new-agent proposal that a new task depends on', async () => {
    const s = await setup({ several: true });
    const store = createSetupStore(s.t.ctx);
    const agent = (name: string) =>
      store.proposeAgent(s.admin, { name, inboxId: 1, purpose: 'Greets.' });
    const first = agent('First greeter');
    for (let i = 0; i < 19; i++) agent(`Greeter ${i}`);
    const task = await store.proposeTask(
      s.admin,
      {
        agentProposalId: first.id,
        chatJid: JEE,
        name: 'Greeting',
        time: '09:00',
        dayRule: 'daily',
        instruction: INSTRUCTION,
      },
      new Set([JEE]),
    );
    expect(store.get(first.id, s.admin)).not.toBeNull();
    expect(store.get(task.id, s.admin)).not.toBeNull();
    // Pushed out later, the pair goes together.
    for (let i = 0; i < 20; i++) agent(`Reminder ${i}`);
    expect(store.get(first.id, s.admin)).toBeNull();
    expect(store.get(task.id, s.admin)).toBeNull();
  });

  it('says the agent serves no number when an edit moves the task of such an agent', async () => {
    const s = await setup();
    const task = s.t.ctx.services.scheduled!.create(
      s.agentId,
      ScheduledTaskBody.parse({
        name: 'Greeting',
        time: '09:00',
        dayRule: 'daily',
        chatJid: JEE,
        instruction: INSTRUCTION,
      }),
      s.actor,
    );
    s.t.ctx.db.prepare('UPDATE ai_agents SET inbox_id = NULL WHERE id = ?').run(s.agentId);
    const store = createSetupStore(s.t.ctx);
    await expect(
      store.proposeTaskEdit(s.admin, { taskId: task.id, chatJid: JEE_LIM }, new Set([JEE_LIM])),
    ).rejects.toThrow('This agent serves no WhatsApp number');
  });

  it('previews an unsaved agent with its preset texts and no business context', async () => {
    const s = await setup();
    s.scheduledTurn.mockRestore();
    const ai = s.t.ctx.services.ai!;
    ai.addText(s.agentId, { name: 'Prices', text: 'Kopi RM5.' }, s.actor);
    vi.mocked(s.provider.generate).mockResolvedValue({
      reply: 'Good morning Jee Fong!',
      action: 'answer',
    } as never);
    const draft = { name: 'Morning greeter', preset: 'faq' as const, instructions: null };
    const task = { name: 'Greeting', instruction: INSTRUCTION };
    const turn = await ai.scheduledTurn(
      { agentId: null, chatJid: JEE, task, preview: true, draft },
      new AbortController().signal,
    );
    expect(turn).toMatchObject({ outcome: 'send', text: 'Good morning Jee Fong!' });
    const [settings, , prompt] = vi.mocked(s.provider.generate).mock.calls.at(-1)!;
    expect(settings).toMatchObject({
      displayName: 'Morning greeter',
      instructions: presetTexts('faq').instructions,
    });
    expect(JSON.stringify(prompt)).not.toContain('Kopi RM5.');
    expect(listAgents(s.t.ctx.db)).toHaveLength(1);
    const refused = await ai.scheduledTurn(
      { agentId: null, chatJid: JEE, task, preview: false, draft },
      new AbortController().signal,
    );
    expect(refused).toMatchObject({ outcome: 'skip', reason: 'agent_off' });
  });
});

describe('Ask Ezy setup: usable new agents (owner test)', { timeout: 30_000 }, () => {
  it('A: writes the new agent from its purpose: custom, no direct chats, never a model preset', async () => {
    const s = await setup({ several: true });
    let withPreset: Record<string, unknown> = {};
    let agentPid = '';
    let taskPid = '';
    s.setScript(async (tools) => {
      withPreset = await exec(tools, 'propose_agent', {
        name: 'Morning greeter',
        preset: 'faq',
        inboxId: 1,
        purpose: 'Sends Jee Fong a short good-morning greeting every day.',
      });
      const agent = await exec(tools, 'propose_agent', {
        name: 'Morning greeter',
        inboxId: 1,
        purpose: 'Sends Jee Fong a short good-morning greeting every day.',
        instructions: 'Mention the weather only when the chat talked about it.',
      });
      agentPid = String(agent.proposalId);
      taskPid = String((await proposeTask(tools, { agentProposalId: agentPid })).proposalId);
      return {
        text: 'Plan.',
        blocks: [
          { type: 'agent_proposal', json: json({ id: agentPid }) },
          { type: 'task_proposal', json: json({ id: taskPid }) },
        ],
        followUps: [],
      };
    });
    const answer = await ask(s.t, s.adminCookie);
    expect(withPreset.error).toBeDefined();
    expect(blockOf(answer, 'agent_proposal')).toMatchObject({
      preset: 'custom',
      note: 'Sends Jee Fong a short good-morning greeting every day.',
    });
    const applied = (await act(s.t, s.adminCookie, taskPid, 'apply')).json();
    const agent = agentById(s.t.ctx.db, applied.agentId)!;
    expect(agent).toMatchObject({ preset: 'custom', answerDirect: false, enabled: false });
    const instructions = s.t.ctx.services.ai!.agentStatus(agent.id).settings.instructions;
    expect(instructions).toContain('Sends Jee Fong a short good-morning greeting every day.');
    expect(instructions).toContain('do not answer');
    expect(instructions).toContain('Mention the weather only when the chat talked about it.');
    expect(instructions).not.toContain(presetTexts('faq').instructions.slice(0, 60));
  });

  it('B: refuses a generic name or the name of an existing agent', async () => {
    const s = await setup({ several: true });
    const errors: string[] = [];
    s.setScript(async (tools) => {
      for (const name of ['New AI agent', 'AI agent', 'Agent', 'Assistant', 'agent 2', 'aina'])
        errors.push(
          String(
            (
              await exec(tools, 'propose_agent', {
                name,
                inboxId: 1,
                purpose: 'Sends the morning greeting.',
              })
            ).error,
          ),
        );
      return { text: 'Names.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie);
    for (const error of errors) expect(error).toContain('Morning greeter');
  });

  it('C: drops a new agent proposed without its task, and asks what it should send', async () => {
    const s = await setup({ several: true });
    let agentPid = '';
    s.setScript(async (tools) => {
      agentPid = String(
        (
          await exec(tools, 'propose_agent', {
            name: 'Morning greeter',
            inboxId: 1,
            purpose: 'Sends the morning greeting.',
          })
        ).proposalId,
      );
      return {
        text: 'Here is your new agent.',
        blocks: [{ type: 'agent_proposal', json: json({ id: agentPid }) }],
        followUps: [],
      };
    });
    const answer = await ask(s.t, s.adminCookie);
    expect(blockOf(answer, 'agent_proposal')).toBeUndefined();
    expect(blockOf(answer, 'setup_note')).toEqual({ type: 'setup_note', code: 'agent_needs_task' });
    const res = await act(s.t, s.adminCookie, agentPid, 'apply');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('agent_needs_task');
    expect(listAgents(s.t.ctx.db)).toHaveLength(1);
  });

  it('D: a setup request reruns on the main model with the same history and the setup tools', async () => {
    const s = await setup({ several: true });
    s.setScript(async () => ({ text: 'Which chat?', blocks: [], followUps: [] }));
    const history = [
      { role: 'user', text: 'Earlier question' },
      { role: 'assistant', text: 'Earlier answer' },
    ];
    const res = await s.t.app.inject({
      method: 'POST',
      url: '/api/ask-ezy',
      headers: authHeaders(s.adminCookie),
      payload: { question: 'Make a new agent that greets Jee Fong at 9am', history },
    });
    const events = res.payload
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AskEzyEvent);
    const last = events.at(-1);
    expect(last?.type === 'answer' && last.answer.text).toBe('Which chat?');
    expect(s.calls).toHaveLength(2);
    const [fast, main] = s.calls as [AiAssistCall, AiAssistCall];
    expect(fast.main).toBeFalsy();
    expect(Object.keys(fast.tools)).toContain('start_setup');
    expect(Object.keys(fast.tools)).not.toContain('propose_agent');
    expect(main.main).toBe(true);
    expect(main.messages).toEqual(fast.messages);
    expect(main.messages).toHaveLength(3);
    expect(Object.keys(main.tools)).toEqual(
      expect.arrayContaining(['propose_agent', 'propose_scheduled_task', 'list_scheduled_tasks']),
    );
    expect(Object.keys(main.tools)).not.toContain('start_setup');
    expect(main.instructions).toContain('Setting up agents and scheduled tasks');
    expect(fast.instructions).not.toContain('Setting up agents and scheduled tasks');
    // "Ezy read" never lists the switch itself.
    expect(last?.type === 'answer' && last.answer.steps.map((st) => st.key)).not.toContain(
      'start_setup',
    );
    const logs = s.logLines.join('\n');
    expect(logs).toContain('ask_ezy_setup_start');
    expect(logs).toContain('gpt-main');
    expect(logs).not.toContain('greets Jee Fong');
    expect(logs).not.toContain('Which chat?');
  });

  it('D: a normal question stays on the fast model with no setup tools', async () => {
    const s = await setup({ several: true, fastOnly: true });
    await ask(s.t, s.adminCookie, 'How is my week?');
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.main).toBeFalsy();
    expect(Object.keys(s.calls[0]!.tools)).not.toContain('propose_scheduled_task');
    expect(s.logLines.join('\n')).not.toContain('ask_ezy_setup_start');
  });

  it('E: names the real agent limit outside Lite', async () => {
    const s = await setup({ several: true });
    const ai = s.t.ctx.services.ai!;
    for (const [name, inboxId] of [
      ['Helpdesk', 2],
      ['Night desk', 2],
    ] as const)
      ai.createAgent({ displayName: name, enabled: false, instructions: '', inboxId }, s.actor);
    let result: Record<string, unknown> = {};
    s.setScript(async (tools) => {
      result = await exec(tools, 'propose_agent', {
        name: 'Morning greeter',
        inboxId: 1,
        purpose: 'Sends the morning greeting.',
      });
      return { text: 'Full.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie);
    expect(String(result.error)).toContain(
      "This EzyChat allows 3 AI agents and all are in use, so I can't add a new one.",
    );
    expect(String(result.error)).not.toContain('Lite');
  });

  it('F: a slow preview never takes the turn down: the card comes without it', async () => {
    const s = await setup();
    s.scheduledTurn.mockImplementation(
      (_input, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ) as never,
    );
    const store = createSetupStore(s.t.ctx, Date.now, { previewTimeoutMs: 50 });
    const started = Date.now();
    const p = await store.proposeTask(
      s.admin,
      {
        agentId: s.agentId,
        chatJid: JEE,
        name: 'Greeting',
        time: '08:30',
        dayRule: 'weekdays',
        instruction: INSTRUCTION,
      },
      new Set([JEE]),
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(p.preview).toBeNull();
    expect(p.previewTimedOut).toBe(true);
  });

  it('H: a turn whose model never answers ends with ai_timeout inside its budget, and logs no text', async () => {
    for (const setupTurn of [false, true]) {
      const s = await setup({ fastOnly: !setupTurn });
      vi.mocked(s.provider.assist!).mockImplementation(async (_s, _k, call: AiAssistCall) => {
        if (setupTurn && !call.main) {
          await exec(call.tools, 'start_setup', {});
          return {
            output: { text: 'x', blocks: [], followUps: [] },
            toolCalls: [],
            steps: 1,
            model: 'f',
          };
        }
        return new Promise(() => {}); // never answers, ignores the signal
      });
      const service = createAskEzyService(s.t.ctx, { budgetMs: 80 });
      const events: AskEzyEvent[] = [];
      const started = Date.now();
      await service.ask(
        s.admin,
        AskEzyRequest.parse({ question: 'Greet Jee Fong every morning please' }),
        (e) => events.push(e),
        new AbortController().signal,
      );
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(events.at(-1)).toEqual({ type: 'error', code: 'ai_timeout' });
      const logs = s.logLines.join('\n');
      expect(logs).toContain('"kind":"budget"');
      expect(logs).toContain(`"setup":${setupTurn}`);
      expect(logs).not.toContain('Greet Jee Fong');
    }
  });

  it('the admin sets the time limit of one question (default 15 min), audited, and the model call gets it', async () => {
    const s = await setup();
    const get = (cookie: string) =>
      s.t.app.inject({ method: 'GET', url: '/api/ask-ezy/settings', headers: authHeaders(cookie) });
    const put = (cookie: string, payload: object) =>
      s.t.app.inject({
        method: 'PUT',
        url: '/api/ask-ezy/settings',
        headers: authHeaders(cookie),
        payload,
      });
    expect((await get(s.adminCookie)).json()).toEqual({ timeoutMinutes: 15 });
    expect((await get(s.memberCookie)).statusCode).toBe(403);
    expect((await put(s.memberCookie, { timeoutMinutes: 5 })).statusCode).toBe(403);
    expect((await put(s.adminCookie, { timeoutMinutes: 7 })).statusCode).toBe(400);
    const saved = await put(s.adminCookie, { timeoutMinutes: 5 });
    expect(saved.json()).toEqual({ timeoutMinutes: 5 });
    await put(s.adminCookie, { timeoutMinutes: 5 }); // unchanged: no second audit row
    const rows = s.t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'settings.ask_ezy_timeout'")
      .all() as Array<{ meta: string }>;
    expect(rows.map((r) => JSON.parse(r.meta))).toEqual([{ before: 15, after: 5 }]);
    // The connection's own 60 s bound is replaced by what is left of the 5 minutes.
    await ask(s.t, s.adminCookie, 'How is my week?');
    const limit = s.calls[0]!.timeoutMs!;
    expect(limit).toBeGreaterThan(4 * 60_000);
    expect(limit).toBeLessThanOrEqual(5 * 60_000);
  });

  it('D: a team member gets no start_setup', async () => {
    const s = await setup({ several: true });
    await ask(s.t, s.memberCookie, 'How is my week?');
    expect(s.calls).toHaveLength(1);
    expect(Object.keys(s.calls[0]!.tools)).not.toContain('start_setup');
  });
});

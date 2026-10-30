import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { ToolSet } from 'ai';
import type { AskEzyAnswer, AskEzyEvent } from '@ezychat/shared';
import type { AiAssistCall, AiProvider } from '../src/ai/provider-types.js';
import type { AssistOutput } from '../src/ai/agent/assist.js';
import { AgentTurnFailure } from '../src/ai/agent/models.js';
import { createAiService } from '../src/ai/service.js';
import { getChats } from '../src/wa-bridge/index.js';
import { lineDiff } from '../src/ask-ezy/changes.js';
import { ASK_EZY_PER_MINUTE } from '../src/routes/ask-ezy.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const JID = '60126677889@s.whatsapp.net';

/** What the fake model does in one turn: calls tools (through the real ToolSet) and returns an output. */
type Script = (tools: ToolSet) => Promise<AssistOutput>;

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

const exec = async (tools: ToolSet, name: string, args: object) => {
  const fn = tools[name]?.execute;
  if (!fn) throw new Error(`no tool ${name}`);
  return (fn as (input: object, options: object) => Promise<unknown>)(args, {
    toolCallId: name,
    messages: [],
    context: {},
  });
};

async function setup(opts: { connected?: boolean } = {}) {
  let script: Script = async () => ({ text: 'Hello', blocks: [], followUps: [] });
  const seen: { calls: AiAssistCall[] } = { calls: [] };
  const logLines: string[] = [];
  const provider: AiProvider = {
    generate: vi.fn(),
    assist: vi.fn(async (_settings, _key, call: AiAssistCall, signal: AbortSignal) => {
      seen.calls.push(call);
      signal.throwIfAborted();
      const output = await script(call.tools);
      return { output, toolCalls: [], steps: 1, model: 'gpt-test' };
    }),
    connection: () => ({
      state: opts.connected === false ? 'signed_out' : 'connected',
      loginUrl: null,
      error: null,
    }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  const t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.ai = createAiService(ctx, { provider });
      const capture = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
      const child = ctx.log.child.bind(ctx.log);
      vi.spyOn(ctx.log, 'child').mockImplementation(((bindings: Record<string, unknown>) =>
        bindings.mod === 'ask-ezy' ? capture.child(bindings) : child(bindings)) as never);
    },
  });
  open.push(t);
  const auth = t.ctx.services.auth!;
  const user = (username: string, role: 'admin' | 'agent') =>
    auth.createUser({
      username,
      displayName: username === 'admin' ? 'Aisyah Rahman' : 'Daniel',
      role,
      password: 'password123',
      mustChangePassword: false,
    });
  const admin = user('admin', 'admin');
  const agent = user('agent', 'agent');
  const cookie = (id: number) =>
    `sid=${auth.createSession(id, { ip: '127.0.0.1', userAgent: 't' })}`;
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'chatgpt', model: '' }, { userId: admin.id, ip: null });
  ai.saveMember(
    {
      displayName: 'Aina',
      enabled: false,
      instructions: 'Be kind.',
      handoffRules: 'Hand over refunds.',
    },
    { userId: admin.id, ip: null },
  );
  ai.addText(
    null,
    { name: 'Delivery areas', text: 'We deliver in George Town.' },
    { userId: admin.id, ip: null },
  );
  getChats(t.ctx).upsertFromWa({ jid: JID, type: 'dm', name: 'Nurul' }, 1);
  const agentId = (t.ctx.db.prepare('SELECT id FROM ai_agents LIMIT 1').get() as { id: number }).id;
  return {
    t,
    provider,
    seen,
    logLines,
    agentId,
    adminCookie: cookie(admin.id),
    agentCookie: cookie(agent.id),
    setScript: (s: Script) => (script = s),
  };
}

const ask = async (t: TestApp, cookie: string, payload: object) => {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/ask-ezy',
    headers: authHeaders(cookie),
    payload,
  });
  const events =
    res.statusCode === 200
      ? res.payload
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as AskEzyEvent)
      : [];
  return { res, events };
};
const answerOf = (events: AskEzyEvent[]): AskEzyAnswer => {
  const last = events.at(-1);
  if (last?.type !== 'answer') throw new Error(`no answer: ${JSON.stringify(last)}`);
  return last.answer;
};
const change = (t: TestApp, cookie: string, id: string, action: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/ask-ezy/changes/${id}/${action}`,
    headers: authHeaders(cookie),
  });

describe('Ask Ezy', () => {
  it('reports the connection and refuses a question without one', async () => {
    const off = await setup({ connected: false });
    const status = await off.t.app.inject({
      method: 'GET',
      url: '/api/ask-ezy/status',
      headers: authHeaders(off.agentCookie),
    });
    expect(status.json()).toEqual({ connected: false });
    const { res } = await ask(off.t, off.agentCookie, { question: 'How is my week?' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ai_not_connected');
    expect(off.provider.assist).not.toHaveBeenCalled();
  });

  it('gives a team member only the read tools, streams each tool as a step, then the answer', async () => {
    const s = await setup();
    s.setScript(async (tools) => {
      expect(Object.keys(tools).sort()).toEqual([
        'get_activity',
        'get_chat',
        'get_messages',
        'get_stats',
        'list_chats',
      ]);
      await exec(tools, 'get_stats', { days: 7 });
      await exec(tools, 'list_chats', { limit: 5 });
      return {
        text: '1 chat is open.',
        blocks: [
          {
            type: 'chats',
            json: JSON.stringify({
              title: 'Open chats',
              chats: [
                { jid: JID, name: 'Nurul', preview: 'Hi', wait: '5 min', assignee: null },
                {
                  jid: '6000@s.whatsapp.net',
                  name: 'Invented',
                  preview: 'x',
                  wait: '1 min',
                  assignee: null,
                },
              ],
            }),
          },
          { type: 'stats', json: '{not json' },
        ],
        followUps: ['Summarise Nurul', 'x'.repeat(300)],
      };
    });
    const { res, events } = await ask(s.t, s.agentCookie, { question: 'Which chats are open?' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(events.slice(0, 2).map((e) => e.type === 'step' && e.key)).toEqual([
      'get_stats',
      'list_chats',
    ]);
    const answer = answerOf(events);
    expect(answer.text).toBe('1 chat is open.');
    // An invented chat id is removed, a malformed block is dropped, long follow-ups are cut.
    expect(answer.blocks).toEqual([
      {
        type: 'chats',
        title: 'Open chats',
        chats: [{ jid: JID, name: 'Nurul', preview: 'Hi', wait: '5 min', assignee: null }],
      },
    ]);
    expect(answer.steps.map((st) => st.key)).toEqual(['get_stats', 'list_chats']);
    expect(answer.followUps[1]!.length).toBeLessThanOrEqual(200);
    // The prompt says who asks and that a team member cannot change the AI.
    expect(s.seen.calls[0]!.instructions).toContain('a team member');
  });

  it('lets an admin apply, undo and discard a change Ezy proposed, with a version and an audit row', async () => {
    const s = await setup();
    let changeId = '';
    s.setScript(async (tools) => {
      expect(tools.update_ai_setup).toBeUndefined();
      expect(tools.send_message).toBeUndefined();
      const r = (await exec(tools, 'propose_ai_setup_change', {
        agentId: s.agentId,
        target: 'handoff_rules',
        text: 'Hand over refunds.\nHand over late orders.',
        reason: '3 late orders were handed over',
      })) as { changeId: string };
      changeId = r.changeId;
      return {
        text: 'One change.',
        blocks: [
          {
            type: 'change',
            json: JSON.stringify({
              id: changeId,
              title: 'Hand over late orders',
              test: {
                question: 'Where is my order?',
                before: 'Let me check.',
                after: 'I passed it on.',
              },
            }),
          },
          { type: 'change', json: JSON.stringify({ id: 'not-a-real-id' }) },
        ],
        followUps: [],
      };
    });
    const { events } = await ask(s.t, s.adminCookie, { question: 'Fix my hand-over rules' });
    const answer = answerOf(events);
    expect(answer.blocks).toHaveLength(1);
    expect(answer.blocks[0]).toMatchObject({
      type: 'change',
      id: changeId,
      agent: 'Aina',
      title: 'Hand over late orders',
      target: 'handoff_rules',
      added: 1,
      removed: 0,
      before: 'Hand over refunds.',
      status: 'proposed',
      test: { after: 'I passed it on.' },
    });
    // Nothing was saved yet.
    const rules = () => s.t.ctx.services.ai!.agentStatus(s.agentId).settings.handoffRules;
    expect(rules()).toBe('Hand over refunds.');

    expect((await change(s.t, s.agentCookie, changeId, 'apply')).statusCode).toBe(403);
    const applied = await change(s.t, s.adminCookie, changeId, 'apply');
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ status: 'applied', version: expect.any(Number) });
    expect(rules()).toBe('Hand over refunds.\nHand over late orders.');
    const version = s.t.ctx.db
      .prepare('SELECT via, reason FROM ai_setup_versions WHERE id = ?')
      .get(applied.json().version) as { via: string; reason: string };
    expect(version).toEqual({ via: 'app', reason: 'Ask Ezy: 3 late orders were handed over' });

    const undone = await change(s.t, s.adminCookie, changeId, 'undo');
    expect(undone.json()).toEqual({ status: 'proposed' });
    expect(rules()).toBe('Hand over refunds.');
    expect((await change(s.t, s.adminCookie, changeId, 'discard')).json()).toEqual({
      status: 'discarded',
    });
    expect((await change(s.t, s.adminCookie, changeId, 'undo')).json()).toEqual({
      status: 'proposed',
    });
  });

  it('never overwrites a text someone saved after Ezy read it', async () => {
    const s = await setup();
    let changeId = '';
    s.setScript(async (tools) => {
      const item = (
        s.t.ctx.db.prepare("SELECT id FROM ai_documents WHERE name = 'Delivery areas'").get() as {
          id: number;
        }
      ).id;
      changeId = (
        (await exec(tools, 'propose_ai_setup_change', {
          agentId: s.agentId,
          target: 'context_text',
          itemId: item,
          text: 'We deliver in George Town.\nBayan Lepas: RM8.',
          reason: '4 customers asked',
        })) as { changeId: string }
      ).changeId;
      return { text: 'One change.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie, { question: 'Improve my knowledge' });
    const item = s.t.ctx.db
      .prepare("SELECT id FROM ai_documents WHERE name = 'Delivery areas'")
      .get() as {
      id: number;
    };
    s.t.ctx.services.ai!.updateText(
      s.agentId,
      item.id,
      { text: 'Edited by a teammate.' },
      {
        userId: 1,
        ip: null,
      },
    );
    const res = await change(s.t, s.adminCookie, changeId, 'apply');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('setup_changed');
    expect(s.t.ctx.services.ai!.document(s.agentId, item.id).text).toBe('Edited by a teammate.');
    expect((await change(s.t, s.adminCookie, 'unknown', 'apply')).statusCode).toBe(404);
  });

  it('adds and updates Business context text items, and undoes each', async () => {
    const s = await setup();
    const ids: string[] = [];
    const results: unknown[] = [];
    const itemId = () =>
      (
        s.t.ctx.db.prepare("SELECT id FROM ai_documents WHERE name = 'Delivery areas'").get() as {
          id: number;
        }
      ).id;
    s.setScript(async (tools) => {
      const propose = (args: object) =>
        exec(tools, 'propose_ai_setup_change', { agentId: s.agentId, reason: 'asked', ...args });
      ids.push(
        (
          (await propose({
            target: 'context_text',
            name: 'Opening hours',
            text: 'Open 9 to 6.',
          })) as {
            changeId: string;
          }
        ).changeId,
        (
          (await propose({
            target: 'context_text',
            itemId: itemId(),
            text: 'We deliver in George Town.\nBayan Lepas: RM8.',
          })) as { changeId: string }
        ).changeId,
      );
      results.push(
        await propose({ target: 'context_text', text: 'No name.' }),
        await propose({ target: 'instructions', name: 'x', text: 'Be brief.' }),
      );
      return { text: 'Two changes.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie, { question: 'Improve my knowledge' });
    expect(results).toEqual([
      { error: 'Give a name to add a new text item' },
      { error: 'itemId and name apply to context_text only' },
    ]);
    const [added, updated] = ids as [string, string];
    const ai = s.t.ctx.services.ai!;
    const opening = () =>
      ai.agentStatus(s.agentId).documents.find((d) => d.name === 'Opening hours');

    expect((await change(s.t, s.adminCookie, added, 'apply')).json().status).toBe('applied');
    expect(ai.document(s.agentId, opening()!.id).text).toBe('Open 9 to 6.');
    // An applied change must be undone before it can be discarded.
    expect((await change(s.t, s.adminCookie, added, 'discard')).json().error.code).toBe(
      'change_applied',
    );
    expect((await change(s.t, s.adminCookie, added, 'undo')).json()).toEqual({
      status: 'proposed',
    });
    expect(opening()).toBeUndefined();

    expect((await change(s.t, s.adminCookie, updated, 'apply')).json().status).toBe('applied');
    expect(ai.document(s.agentId, itemId()).text).toBe(
      'We deliver in George Town.\nBayan Lepas: RM8.',
    );
    // Undo never overwrites a teammate's later edit.
    ai.updateText(s.agentId, itemId(), { text: 'Edited later.' }, { userId: 1, ip: null });
    const undo = await change(s.t, s.adminCookie, updated, 'undo');
    expect(undo.statusCode).toBe(409);
    expect(undo.json().error.code).toBe('setup_changed');
    expect(ai.document(s.agentId, itemId()).text).toBe('Edited later.');
  });

  it('refuses a proposal the model gets wrong and tells the model why', async () => {
    const s = await setup();
    const results: unknown[] = [];
    s.setScript(async (tools) => {
      results.push(
        await exec(tools, 'propose_ai_setup_change', {
          agentId: s.agentId,
          target: 'handoff_rules',
          text: 'Hand over refunds.',
          reason: 'same text',
        }),
        await exec(tools, 'propose_ai_setup_change', {
          agentId: 9999,
          target: 'instructions',
          text: 'x',
          reason: 'unknown agent',
        }),
      );
      return { text: 'No change.', blocks: [], followUps: [] };
    });
    await ask(s.t, s.adminCookie, { question: 'Fix it' });
    expect(results).toEqual([
      { error: 'The new text is the same as the saved text' },
      { error: 'Unknown agentId: call list_ai_agents first' },
    ]);
  });

  it('answers a failed turn with an error line and logs no question or customer text', async () => {
    const s = await setup();
    s.setScript(async (tools) => {
      await exec(tools, 'list_chats', { limit: 5 });
      return { text: 'Nurul asked about delivery.', blocks: [], followUps: [] };
    });
    const ok = await ask(s.t, s.agentCookie, { question: 'A secret question about Nurul' });
    expect(answerOf(ok.events).text).toBe('Nurul asked about delivery.');
    s.setScript(async () => {
      throw new AgentTurnFailure('slow', 'timeout', 'TimeoutError');
    });
    const timeout = await ask(s.t, s.agentCookie, { question: 'A secret question about Nurul' });
    expect(timeout.events).toEqual([{ type: 'error', code: 'ai_timeout' }]);
    s.setScript(async () => {
      throw new Error('boom with Nurul');
    });
    const other = await ask(s.t, s.agentCookie, { question: 'Another one' });
    expect(other.events).toEqual([{ type: 'error', code: 'ai_unavailable' }]);
    const lines = s.logLines.join('\n');
    expect(lines).toContain('"event":"ask_ezy"');
    expect(lines).toContain('"tools":["list_chats"]');
    expect(lines).toContain('"code":"ai_timeout"');
    expect(lines).not.toMatch(/secret|Nurul|boom|delivery/);
  });

  it('scopes a question to a chat the user may open and limits questions per minute', async () => {
    const s = await setup();
    const unknown = await ask(s.t, s.agentCookie, {
      question: 'Summarise',
      chatJid: '6099@s.whatsapp.net',
    });
    expect(unknown.res.statusCode).toBe(404);
    const scoped = await ask(s.t, s.agentCookie, { question: 'Summarise', chatJid: JID });
    expect(scoped.res.statusCode).toBe(200);
    expect(s.seen.calls.at(-1)!.instructions).toContain(`chat id ${JID}`);
    for (let i = 1; i < ASK_EZY_PER_MINUTE; i++) await ask(s.t, s.agentCookie, { question: 'q' });
    const limited = await ask(s.t, s.agentCookie, { question: 'one too many' });
    expect(limited.res.statusCode).toBe(429);
  });
});

describe('lineDiff', () => {
  it('counts added and removed lines, ignoring blank lines and order', () => {
    expect(lineDiff('a\nb', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
    expect(lineDiff('a\nb', 'b\na')).toEqual({ added: 0, removed: 0 });
    expect(lineDiff('a\n\nb', 'a\nc')).toEqual({ added: 1, removed: 1 });
  });
});

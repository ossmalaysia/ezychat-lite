import { afterEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { AiTaskModelsStatus } from '@ezychat/shared';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { getChats } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const JID = '60126677889@s.whatsapp.net';
const TRY = {
  question: 'Price of nasi lemak?',
  knowledge: { displayName: 'Aina', instructions: 'Be warm.', handoffRules: '' },
};

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

/** An app with a mock AI provider (never a real one) and a ChatGPT connection on Auto. */
async function setup() {
  const logLines: string[] = [];
  const provider: AiProvider = {
    generate: vi.fn().mockResolvedValue({ reply: 'Hello!', action: 'answer', handoffReason: null }),
    draft: vi.fn().mockResolvedValue({ output: {}, model: 'gpt-6-luna' }),
    rewrite: vi.fn().mockResolvedValue({ text: 'Better text', model: 'gpt-6-luna' }),
    assist: vi.fn().mockResolvedValue({
      output: { text: 'Hi', blocks: [], followUps: [] },
      toolCalls: [],
      steps: 1,
      model: 'gpt-6-luna',
    }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
    knownModels: () => ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-terra'],
  };
  const t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      const capture = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
      const child = ctx.log.child.bind(ctx.log);
      vi.spyOn(ctx.log, 'child').mockImplementation(((bindings: Record<string, unknown>) =>
        bindings.mod === 'ai' ? capture.child(bindings) : child(bindings)) as never);
      ctx.services.ai = createAiService(ctx, { provider });
    },
  });
  open.push(t);
  const auth = t.ctx.services.auth!;
  const user = (username: string, role: 'admin' | 'agent') =>
    auth.createUser({
      username,
      displayName: username,
      role,
      password: 'password123',
      mustChangePassword: false,
    });
  const admin = user('admin', 'admin');
  const agentUser = user('agent', 'agent');
  const cookie = (id: number) =>
    `sid=${auth.createSession(id, { ip: '127.0.0.1', userAgent: 't' })}`;
  const actor = { userId: admin.id, ip: null };
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'chatgpt', model: '' }, actor);
  ai.saveMember({ displayName: 'Aina', enabled: false, instructions: 'Be warm.' }, actor);
  ai.addText(null, { name: 'Menu', text: 'Nasi Lemak Ayam RM12. Open daily 8am to 10pm.' }, actor);
  getChats(t.ctx).upsertFromWa({ jid: JID, type: 'dm', name: 'Nurul Huda' }, 1);
  const inject = (cookieValue: string, method: 'GET' | 'PUT', url: string, payload?: object) =>
    t.app.inject({
      method,
      url,
      headers: authHeaders(cookieValue),
      ...(payload ? { payload } : {}),
    });
  return {
    t,
    ai,
    provider,
    actor,
    logLines,
    admin: cookie(admin.id),
    agent: cookie(agentUser.id),
    inject,
    put: (tasks: object) => inject(cookie(admin.id), 'PUT', '/api/ai/task-models', { tasks }),
  };
}

const audits = (t: TestApp) =>
  (
    t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'settings.ai_task_model' ORDER BY id")
      .all() as { meta: string }[]
  ).map((r) => JSON.parse(r.meta));

describe('AI models routes', () => {
  it('shows the defaults of the current connection to admins only', async () => {
    const s = await setup();
    const res = await s.inject(s.admin, 'GET', '/api/ai/task-models');
    expect(res.statusCode).toBe(200);
    const status = AiTaskModelsStatus.parse(res.json());
    expect(status).toMatchObject({
      mode: 'chatgpt',
      mainModel: 'gpt-6.1-sol',
      fastModel: 'gpt-6-luna',
    });
    expect(status.tasks.agentReplies).toMatchObject({
      choice: 'main',
      effectiveThinking: 'medium',
      isDefault: true,
    });
    expect(status.tasks.translate).toMatchObject({ choice: 'fast', model: 'gpt-6-luna' });
    expect((await s.inject(s.agent, 'GET', '/api/ai/task-models')).statusCode).toBe(403);
  });

  it('saves a row, audits before/after only, and returns it to the default', async () => {
    const s = await setup();
    const res = await s.put({ writing: { choice: 'gpt-6.1-sol', thinking: 'high' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tasks.writing).toMatchObject({
      choice: 'gpt-6.1-sol',
      thinking: 'high',
      effectiveThinking: 'high',
      isDefault: false,
    });
    // The same save again changes nothing and is not audited twice.
    await s.put({ writing: { choice: 'gpt-6.1-sol', thinking: 'high' } });
    expect((await s.put({ writing: null })).json().tasks.writing.isDefault).toBe(true);
    expect(audits(s.t)).toEqual([
      {
        mode: 'chatgpt',
        task: 'writing',
        before: { choice: null, thinking: null },
        after: { choice: 'gpt-6.1-sol', thinking: 'high' },
      },
      {
        mode: 'chatgpt',
        task: 'writing',
        before: { choice: 'gpt-6.1-sol', thinking: 'high' },
        after: { choice: null, thinking: null },
      },
    ]);
  });

  it('refuses a model the connection does not list, a level the model lacks and bad bodies', async () => {
    const s = await setup();
    const unlisted = await s.put({ translate: { choice: 'gpt-9-nova' } });
    expect(unlisted.statusCode).toBe(400);
    expect(unlisted.json().error.code).toBe('model_not_listed');
    s.ai.saveConnection(
      { mode: 'claude', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-0000000' },
      s.actor,
    );
    const thinking = await s.put({ translate: { choice: 'claude-opus-5-5', thinking: 'high' } });
    expect(thinking.statusCode).toBe(400);
    expect(thinking.json().error.code).toBe('thinking_not_supported');
    expect((await s.put({ nope: { choice: 'fast' } })).statusCode).toBe(400);
    // Nothing of a refused body was saved.
    expect(s.t.ctx.settings.get('ai_task_models', null)).toEqual({});
  });

  it('keeps each connection’s own choices', async () => {
    const s = await setup();
    await s.put({ translate: { choice: 'main' } });
    s.ai.saveConnection(
      { mode: 'claude', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-0000000' },
      s.actor,
    );
    expect((await s.put({ translate: { choice: 'claude-opus-5-5' } })).statusCode).toBe(200);
    expect(s.ai.taskModels().tasks.translate.model).toBe('claude-opus-5-5');
    s.ai.saveConnection({ mode: 'chatgpt', model: '' }, s.actor);
    expect(s.ai.taskModels().tasks.translate).toMatchObject({ choice: 'main' });
    expect(s.t.ctx.settings.get('ai_task_models', null)).toEqual({
      chatgpt: { translate: { choice: 'main' } },
      claude: { translate: { choice: 'claude-opus-5-5' } },
    });
  });

  it('limits saves to 30 a minute per admin', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) await s.put({ askEzy: null });
    expect((await s.put({ askEzy: null })).statusCode).toBe(429);
  });

  it('writes the Writing help row from the older reply-suggestions route', async () => {
    const s = await setup();
    const put = (model: string) => s.inject(s.admin, 'PUT', '/api/ai/reply-suggestions', { model });
    expect((await put('agent')).statusCode).toBe(200);
    expect(s.ai.taskModels().tasks.writing.choice).toBe('main');
    await put('gpt-5.6-terra');
    expect(s.ai.taskModels().tasks.writing.choice).toBe('gpt-5.6-terra');
    // The same model keeps the row's Speed and quality level.
    s.ai.setTaskModels(
      { tasks: { writing: { choice: 'gpt-5.6-terra', thinking: 'high' } } },
      s.actor,
    );
    await put('gpt-5.6-terra');
    expect(s.ai.taskModels().tasks.writing.thinking).toBe('high');
    await put('agent');
    expect(s.ai.taskModels().tasks.writing).toMatchObject({ choice: 'main', thinking: null });
    await put('fast');
    expect(s.ai.taskModels().tasks.writing.isDefault).toBe(true);
  });
});

describe('AI calls follow their row', () => {
  it('AI agent replies: Try it on the chosen model and level, Main sends no level', async () => {
    const s = await setup();
    await s.ai.tryAnswer(TRY);
    let [settings, , prompt] = vi.mocked(s.provider.generate).mock.calls.at(-1)!;
    expect(settings.model).toBe('');
    expect(prompt.reasoningEffort).toBeUndefined();
    s.ai.setTaskModels(
      { tasks: { agentReplies: { choice: 'gpt-5.6-terra', thinking: 'high' } } },
      s.actor,
    );
    const result = await s.ai.tryAnswer(TRY);
    [settings, , prompt] = vi.mocked(s.provider.generate).mock.calls.at(-1)!;
    expect(settings.model).toBe('gpt-5.6-terra');
    expect(prompt.reasoningEffort).toBe('high');
    expect(result.model).toBe('gpt-5.6-terra');
  });

  it('Writing help: Edit with AI and reply drafts use the row, and the log carries task and level', async () => {
    const s = await setup();
    s.ai.setTaskModels({ tasks: { writing: { choice: 'main', thinking: 'medium' } } }, s.actor);
    await s.ai.editText({ field: 'instructions', current: 'Be warm.', request: 'Shorter' });
    const [settings, , prompt] = vi.mocked(s.provider.rewrite!).mock.calls.at(-1)!;
    expect(settings.model).toBe('');
    expect(prompt.reasoningEffort).toBe('medium');
    const edit = s.logLines.map((l) => JSON.parse(l)).find((l) => l.event === 'ai_edit');
    expect(edit).toMatchObject({ task: 'writing', thinking: 'medium' });
    expect(JSON.stringify(edit)).not.toContain('Shorter');

    vi.mocked(s.provider.draft!).mockResolvedValueOnce({
      output: { completion: 'thanks!' },
      model: 'gpt-6.1-sol',
    });
    await s.inject(s.agent, 'PUT', '/api/ai/reply-suggestions', {});
    await s.t.app.inject({
      method: 'POST',
      url: `/api/chats/${encodeURIComponent(JID)}/ai/complete`,
      headers: authHeaders(s.agent),
      payload: { text: 'Hi there ' },
    });
    const [, , draftPrompt, options] = vi.mocked(s.provider.draft!).mock.calls.at(-1)!;
    expect(options).toMatchObject({ fast: false });
    expect(draftPrompt.reasoningEffort).toBe('medium');
  });

  it('Translate and Background checks run on Fast by default, each on its own row', async () => {
    const s = await setup();
    s.ai.setTaskModels(
      { tasks: { translate: { choice: 'gpt-6.1-sol', thinking: 'low' } } },
      s.actor,
    );
    vi.mocked(s.provider.draft!).mockResolvedValueOnce({
      output: { items: [{ id: 'a', translation: 'Hello', detected: 'ms' }] },
      model: 'gpt-6.1-sol',
    });
    const translated = await s.ai.translate(
      JID,
      { items: [{ id: 'a', text: 'Helo' }], target: 'en' },
      new AbortController().signal,
    );
    expect(translated).toMatchObject({ model: 'gpt-6.1-sol', thinking: 'low' });
    let [settings, , prompt, options] = vi.mocked(s.provider.draft!).mock.calls.at(-1)!;
    expect(settings.model).toBe('gpt-6.1-sol');
    expect(options.fast).toBe(false);
    expect(prompt.reasoningEffort).toBe('low');

    vi.mocked(s.provider.draft!).mockResolvedValueOnce({
      output: { level: 'none', category: 'none', reason: '' },
      model: 'gpt-6-luna',
    });
    await s.ai.checkSafety(JID, 'hello', new AbortController().signal);
    [settings, , prompt, options] = vi.mocked(s.provider.draft!).mock.calls.at(-1)!;
    expect(settings.model).toBe('gpt-6-luna');
    expect(options.fast).toBe(true);
    expect(prompt.reasoningEffort).toBe('low');
    const safety = s.logLines.map((l) => JSON.parse(l)).find((l) => l.event === 'safety_check');
    expect(safety).toMatchObject({ task: 'background', thinking: 'low' });
  });

  it('Ask Ezy: a question runs on its row; a setup turn stays on the main model', async () => {
    const s = await setup();
    const signal = new AbortController().signal;
    const traces: unknown[] = [];
    const call = {
      instructions: 'x',
      messages: [],
      tools: {},
      onTrace: (t: unknown) => traces.push(t),
    };
    await s.ai.assist(call, signal);
    let [settings, , sent] = vi.mocked(s.provider.assist!).mock.calls.at(-1)!;
    expect(sent.main).toBeUndefined();
    expect(sent.reasoningEffort).toBe('low');
    expect(settings.model).toBe('gpt-6-luna');
    sent.onTrace?.({ call: 1 } as never);
    expect(traces).toEqual([{ call: 1, task: 'askEzy', thinking: 'low' }]);

    s.ai.setTaskModels({ tasks: { askEzy: { choice: 'gpt-6.1-sol', thinking: 'high' } } }, s.actor);
    await s.ai.assist(call, signal);
    [settings, , sent] = vi.mocked(s.provider.assist!).mock.calls.at(-1)!;
    expect(sent).toMatchObject({ main: true, reasoningEffort: 'high' });
    expect(settings.model).toBe('gpt-6.1-sol');

    await s.ai.assist({ ...call, main: true }, signal);
    [settings, , sent] = vi.mocked(s.provider.assist!).mock.calls.at(-1)!;
    expect(sent.reasoningEffort).toBeUndefined();
    expect(settings.model).toBe('');
  });

  it('an unlisted saved model runs on the fallback', async () => {
    const s = await setup();
    s.t.ctx.settings.set('ai_task_models', {
      chatgpt: { writing: { choice: 'gpt-5.6-sol', thinking: 'high' } },
    });
    expect(s.ai.taskModels().tasks.writing).toMatchObject({
      unavailable: 'gpt-5.6-sol',
      model: 'gpt-6-luna',
      effectiveThinking: 'low',
    });
    await s.ai.editText({ field: 'instructions', current: 'Be warm.', request: 'Shorter' });
    const [settings, , prompt] = vi.mocked(s.provider.rewrite!).mock.calls.at(-1)!;
    expect(settings.model).toBe('gpt-6-luna');
    expect(prompt.reasoningEffort).toBe('low');
  });
});

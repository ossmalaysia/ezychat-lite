import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { setReplySuggestions } from '../src/ai/reply-suggestions-setting.js';
import { HttpError } from '../src/http/errors.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const JID = '60126677889@s.whatsapp.net';
const DRAFTS = {
  suggestions: [
    { label: 'Confirm price', text: 'Two Nasi Lemak Ayam at RM12 each.', grounded: true },
    { label: 'Ask the name', text: 'May I have your name for the pickup?', grounded: true },
  ],
  noAnswer: false,
  handoffRule: null,
};

let t: TestApp;
let provider: AiProvider;
let connection: 'connected' | 'expired' | 'signed_out';
let logLines: string[];
let adminCookie: string;
let actor: { userId: number; ip: null };

beforeEach(async () => {
  logLines = [];
  connection = 'connected';
  provider = {
    generate: vi.fn(),
    draft: vi.fn().mockResolvedValue({ output: DRAFTS, model: 'gpt-test' }),
    connection: () => ({ state: connection, loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      const capture = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
      const child = ctx.log.child.bind(ctx.log);
      vi.spyOn(ctx.log, 'child').mockImplementation(((bindings: Record<string, unknown>) =>
        bindings.mod === 'ai' ? capture.child(bindings) : child(bindings)) as never);
      ctx.services.ai = createAiService(ctx, { provider });
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
  adminCookie = `sid=${auth.createSession(admin.id, { ip: '127.0.0.1', userAgent: 't' })}`;
  actor = { userId: admin.id, ip: null };
  const ai = t.ctx.services.ai!;
  ai.saveConnection({ mode: 'chatgpt', model: '' }, actor);
  // The agent stays off: drafts need only the connection.
  ai.saveMember({ displayName: 'Aina', enabled: false, instructions: 'Be warm.' }, actor);
  ai.addText(null, { name: 'Menu', text: 'Nasi Lemak Ayam RM12. Pickup daily.' }, actor);
  ai.addText(null, { name: 'Costs', text: 'MARK-internal supplier price', internal: true }, actor);
  t.wa.simulateIncoming({ chatJid: JID, body: 'Can I order two Nasi Lemak for pickup at 1pm?' });
  await vi.waitFor(() =>
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 1 }),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

const sentPrompt = () => {
  const [, , prompt, options] = vi.mocked(provider.draft!).mock.calls.at(-1)!;
  return { prompt, options, input: JSON.parse(prompt.input) as Record<string, any> };
};

describe('draftReply', () => {
  it("uses the agent's business context while the agent is off", async () => {
    const result = await t.ctx.services.ai!.draftReply(
      JID,
      { kind: 'suggest' },
      new AbortController().signal,
    );
    expect(result).toEqual({
      suggestions: [
        { label: 'Confirm price', text: 'Two Nasi Lemak Ayam at RM12 each.' },
        { label: 'Ask the name', text: 'May I have your name for the pickup?' },
      ],
      noAnswer: false,
      handoffRule: null,
    });
    const { prompt, options, input } = sentPrompt();
    expect(input.businessKnowledge).toContain('Nasi Lemak Ayam RM12');
    expect(input.internalKnowledge).toContain('MARK-internal');
    expect(prompt.instructions).toContain('Be warm.');
    expect(prompt.cacheId).toMatch(/#agent:\d+$/);
    expect(options).toMatchObject({ fast: false, maxOutputTokens: 2000 });
  });

  it('sends the conversation and the saved customer details last', async () => {
    await t.app.inject({
      method: 'PUT',
      url: `/api/chats/${encodeURIComponent(JID)}/profile`,
      headers: authHeaders(adminCookie),
      payload: { name: 'Nurul Huda', tags: [] },
    });
    await t.ctx.services.ai!.draftReply(JID, { kind: 'suggest' }, new AbortController().signal);
    const { input } = sentPrompt();
    expect(input.conversation).toEqual([
      { speaker: 'customer', text: 'Can I order two Nasi Lemak for pickup at 1pm?' },
    ]);
    expect(input.currentSituation.customer).toEqual({ name: 'Nurul Huda' });
  });

  it('uses no business context when the inbox has no agent', async () => {
    const ai = t.ctx.services.ai!;
    // Lite keeps its one agent on inbox 1; an Enterprise inbox can have none (same lookup).
    t.ctx.db.prepare('UPDATE ai_agents SET inbox_id = NULL').run();
    await ai.draftReply(JID, { kind: 'suggest' }, new AbortController().signal);
    const { prompt, input } = sentPrompt();
    expect(input.businessKnowledge).toBe('');
    expect(input.internalKnowledge).toBe('');
    expect(prompt.cacheId).toMatch(/#agent:0$/);
  });

  it('completes with the fast model and the typed text', async () => {
    vi.mocked(provider.draft!).mockResolvedValueOnce({
      output: { completion: 'Lemak Ayam at RM12 each.', grounded: true },
      model: 'gpt-mini',
    });
    const result = await t.ctx.services.ai!.draftReply(
      JID,
      { kind: 'complete', typed: 'Two Nasi ' },
      new AbortController().signal,
    );
    expect(result).toEqual({ completion: 'Lemak Ayam at RM12 each.' });
    const { options, input } = sentPrompt();
    expect(options).toMatchObject({ fast: true, maxOutputTokens: 300 });
    expect(input.currentSituation.typed).toBe('Two Nasi ');
  });

  it('throws ai_suggestions_off when switched off, without a model call', async () => {
    setReplySuggestions(t.ctx, false, actor);
    const call = t.ctx.services.ai!.draftReply(
      JID,
      { kind: 'suggest' },
      new AbortController().signal,
    );
    await expect(call).rejects.toBeInstanceOf(HttpError);
    await expect(call).rejects.toMatchObject({ status: 409, code: 'ai_suggestions_off' });
    expect(provider.draft).not.toHaveBeenCalled();
  });

  it('throws ai_unavailable when the connection is expired', async () => {
    connection = 'expired';
    await expect(
      t.ctx.services.ai!.draftReply(JID, { kind: 'suggest' }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 503, code: 'ai_unavailable' });
    expect(t.ctx.services.ai!.draftConnection()).toBe('unavailable');
  });

  it('returns completion null after 3 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.mocked(provider.draft!).mockImplementationOnce(
        (_s, _k, _p, _o, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason)),
          ),
      );
      const pending = t.ctx.services.ai!.draftReply(
        JID,
        { kind: 'complete', typed: 'Two Nasi ' },
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toEqual({ completion: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs kind, ok, ms, model and count only', async () => {
    await t.ctx.services.ai!.draftReply(JID, { kind: 'suggest' }, new AbortController().signal);
    const line = logLines.map((l) => JSON.parse(l)).find((l) => l.event === 'ai_draft');
    expect(line).toMatchObject({ kind: 'suggest', ok: true, model: 'gpt-test', count: 2 });
    expect(typeof line.ms).toBe('number');
    const raw = logLines.join('\n');
    expect(raw).not.toContain('Nasi Lemak');
    expect(raw).not.toContain('pickup');
  });

  it('reports no connection when signed out, and API-key modes by their saved key', () => {
    const ai = t.ctx.services.ai!;
    connection = 'signed_out';
    expect(ai.draftConnection()).toBe('none');
    t.ctx.settings.set('ai_inbox_provider', { mode: 'api', model: '' });
    expect(ai.draftConnection()).toBe('none');
    t.ctx.settings.setSecret('ai_api_key', 'sk-test');
    expect(ai.draftConnection()).toBe('ready');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { Message } from '@ezychat/shared';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { createPhraseService, PHRASE_CALLS_PER_DAY } from '../src/ai/phrases/service.js';
import {
  setReplySuggestions,
  setReplySuggestionsModel,
} from '../src/ai/reply-suggestions-setting.js';
import { getChats } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const JID = '60126677889@s.whatsapp.net';
const HOUR = 3_600_000;
const BUILT = {
  phrases: [
    { text: 'Thank you for your message!', language: 'en', source: 'team' },
    { text: 'Nasi Lemak Ayam is RM12.', language: 'en', source: 'context' },
    { text: 'Nasi Lemak Ayam is RM15.', language: 'en', source: 'context' },
    { text: 'Hi Nurul, see you soon!', language: 'en', source: 'team' },
    { text: 'Terima kasih atas mesej anda!', language: 'ms', source: 'team' },
  ],
};

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

async function setup(opts: { inboxes?: number } = {}) {
  const logLines: string[] = [];
  const provider: AiProvider = {
    generate: vi.fn(),
    draft: vi.fn().mockResolvedValue({ output: BUILT, model: 'gpt-6-luna' }),
    connection: () => ({ state: 'connected', loginUrl: null, error: null }),
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  let clock = Date.UTC(2026, 9, 26, 2);
  const t = await makeTestApp({
    ...(opts.inboxes ? { maxInboxes: 3, inboxes: opts.inboxes } : {}),
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      await ctx.services.phrases!.shutdown();
      const capture = pino({ level: 'debug' }, { write: (line: string) => logLines.push(line) });
      const child = ctx.log.child.bind(ctx.log);
      vi.spyOn(ctx.log, 'child').mockImplementation(((bindings: Record<string, unknown>) =>
        bindings.mod === 'ai' ? capture.child(bindings) : child(bindings)) as never);
      ctx.services.ai = createAiService(ctx, { provider });
      ctx.services.phrases = createPhraseService(ctx, { timers: false, now: () => clock });
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
  /** A teammate's sent text reply, as the message service stores it. */
  const teamReply = (body: string, at = clock) =>
    t.ctx.db
      .prepare(
        "INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, status, timestamp, created_at) VALUES (?, ?, 1, ?, 'text', ?, 'sent', ?, ?)",
      )
      .run(`m${Math.random()}`, JID, admin.id, body, at, at);
  return {
    t,
    provider,
    phrases: t.ctx.services.phrases!,
    actor,
    adminCookie: cookie(admin.id),
    agentCookie: cookie(agentUser.id),
    teamReply,
    logLines,
    advance: (ms: number) => (clock += ms),
    sentPrompt: () => {
      const [, , prompt, options] = vi.mocked(provider.draft!).mock.calls.at(-1)!;
      return { prompt, options, input: JSON.parse(prompt.input) as Record<string, any> };
    },
  };
}

const enc = encodeURIComponent;
const inject = (
  t: TestApp,
  cookie: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers: authHeaders(cookie), ...(payload ? { payload } : {}) });

describe('phrase build', () => {
  it('builds at start from the cleaned team replies, keeps only checked phrases, logs counts', async () => {
    const s = await setup();
    s.teamReply('Hi Nurul Huda! Call me at 012-345 6789 or nurul@example.com.');
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
    const { prompt, options, input } = s.sentPrompt();
    expect(prompt.instructions).toContain('phrase list');
    expect(prompt.instructions).toContain('Be warm.');
    expect(input.businessKnowledge).toContain('Nasi Lemak Ayam RM12');
    expect(input.teamReplies).toEqual(['Hi [name]! Call me at [number] or [email].']);
    expect(JSON.stringify(input)).not.toContain('Nurul');
    expect(options).toMatchObject({ fast: true });
    const admin = s.phrases.admin();
    expect(admin.phrases.map((p) => p.text).sort()).toEqual([
      'Nasi Lemak Ayam is RM12.',
      'Terima kasih atas mesej anda!',
      'Thank you for your message!',
    ]);
    expect(admin.status).toMatchObject({
      state: 'ready',
      count: 3,
      trigger: 'start',
      aiCallsToday: 1,
    });
    expect(admin.status.languages).toEqual([
      { language: 'en', count: 2 },
      { language: 'ms', count: 1 },
    ]);
    const line = s.logLines.map((l) => JSON.parse(l)).find((l) => l.event === 'phrase_build');
    expect(line).toMatchObject({
      ok: true,
      trigger: 'start',
      added: 3,
      dropped: { number: 1, name: 1 },
    });
    expect(s.logLines.join('\n')).not.toContain('Thank you');
    // Nothing more to do in the next round.
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
  });

  it('does nothing while reply suggestions are off, and the composer gets no phrases', async () => {
    const s = await setup();
    await s.phrases.tick();
    setReplySuggestions(s.t.ctx, false, s.actor);
    s.advance(8 * 24 * HOUR);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
    expect(s.phrases.forChat(JID)).toEqual([]);
    const res = await inject(s.t, s.adminCookie, 'POST', '/api/ai/phrases/rebuild', {});
    expect(res.statusCode).toBe(409);
    // The phrases stay for when the switch is on again.
    expect(s.phrases.admin().status.count).toBe(3);
  });

  it('rebuilds after a business context change that stayed for one round', async () => {
    const s = await setup();
    await s.phrases.tick();
    s.t.ctx.services.ai!.addText(null, { name: 'Drinks', text: 'Teh Tarik RM4.' }, s.actor);
    s.advance(60_000);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
    s.advance(60_000);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(2);
    expect(s.phrases.admin().status.trigger).toBe('context');
  });

  it('rebuilds after 30 team replies in direct chats, and counts only human text replies', async () => {
    const s = await setup();
    await s.phrases.tick();
    const msg = (over: Partial<Message> = {}) =>
      ({
        id: 'x',
        chatJid: JID,
        fromMe: true,
        sentByUserId: 1,
        type: 'text',
        body: 'ok',
        ...over,
      }) as Message;
    const adminId = s.t.ctx.db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as {
      id: number;
    };
    for (let i = 0; i < 29; i++) s.t.ctx.bus.emit('message:new', msg({ sentByUserId: adminId.id }));
    s.t.ctx.bus.emit('message:new', msg({ sentByUserId: adminId.id, type: 'image' }));
    s.t.ctx.bus.emit('message:new', msg({ sentByUserId: null }));
    s.t.ctx.bus.emit('message:new', msg({ fromMe: false, sentByUserId: adminId.id }));
    expect(s.phrases.admin().status.newReplies).toBe(29);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
    s.t.ctx.bus.emit('message:new', msg({ sentByUserId: adminId.id }));
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(2);
    expect(s.phrases.admin().status).toMatchObject({ trigger: 'replies', newReplies: 0 });
  });

  it('rebuilds weekly, and at start when the list is older than a day', async () => {
    const s = await setup();
    await s.phrases.tick();
    s.advance(6 * 24 * HOUR);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
    s.advance(2 * 24 * HOUR);
    await s.phrases.tick();
    expect(s.phrases.admin().status.trigger).toBe('weekly');
    // A new process start with a list older than a day.
    const again = createPhraseService(s.t.ctx, {
      timers: false,
      now: () => Date.now() + 9 * 24 * HOUR,
    });
    await again.tick();
    await again.shutdown();
    expect(s.provider.draft).toHaveBeenCalledTimes(3);
  });

  it('shows an error after a failed first build and waits an hour before trying again', async () => {
    const s = await setup();
    vi.mocked(s.provider.draft!).mockRejectedValueOnce(
      Object.assign(new Error('boom'), { name: 'AI_APICallError' }),
    );
    await s.phrases.tick();
    expect(s.phrases.admin().status.state).toBe('error');
    const failed = s.logLines.map((l) => JSON.parse(l)).find((l) => l.event === 'phrase_build');
    expect(failed).toMatchObject({ ok: false, causeName: 'AI_APICallError' });
    s.advance(30 * 60_000);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
    s.advance(31 * 60_000);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(2);
    expect(s.phrases.admin().status.state).toBe('ready');
  });

  it(`stops at ${PHRASE_CALLS_PER_DAY} AI calls a day, also for Rebuild now`, async () => {
    const s = await setup();
    s.t.ctx.settings.set('ai_phrases_calls', { day: '2026-10-26', count: PHRASE_CALLS_PER_DAY });
    await s.phrases.tick();
    expect(s.provider.draft).not.toHaveBeenCalled();
    const res = await inject(s.t, s.adminCookie, 'POST', '/api/ai/phrases/rebuild', {});
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('phrase_build_limit');
    s.advance(24 * HOUR);
    await s.phrases.tick();
    expect(s.provider.draft).toHaveBeenCalledTimes(1);
  });

  it('prunes AI phrases nobody used for 30 days, keeps used and admin ones', async () => {
    const s = await setup();
    await s.phrases.tick();
    const [first] = s.phrases.admin().phrases;
    s.phrases.feedback(JID, first!.id, true);
    s.phrases.add({ text: 'Please send the receipt.', language: 'en' }, s.actor);
    s.advance(31 * 24 * HOUR);
    vi.mocked(s.provider.draft!).mockResolvedValue({
      output: { phrases: [] },
      model: 'gpt-6-luna',
    });
    await s.phrases.tick();
    expect(
      s.phrases
        .admin()
        .phrases.map((p) => p.text)
        .sort(),
    ).toEqual([first!.text, 'Please send the receipt.'].sort());
  });

  it('uses the model for suggestions: the saved agent model when chosen', async () => {
    const s = await setup();
    setReplySuggestionsModel(s.t.ctx, 'agent', s.actor);
    await s.phrases.tick();
    expect(s.sentPrompt().options).toMatchObject({ fast: false });
  });

  it('deletes the list with its agent', async () => {
    const s = await setup();
    await s.phrases.tick();
    const agentId = s.phrases.admin().agentId!;
    s.t.ctx.db.prepare('DELETE FROM ai_agents WHERE id = ?').run(agentId);
    expect(s.t.ctx.db.prepare('SELECT COUNT(*) AS n FROM reply_phrases').get()).toEqual({ n: 0 });
  });
});

describe('phrase routes', () => {
  it('gives every teammate the chat list, most used first, and counts Tab and Esc', async () => {
    const s = await setup();
    await s.phrases.tick();
    const list = await inject(s.t, s.agentCookie, 'GET', `/api/chats/${enc(JID)}/ai/phrases`);
    expect(list.statusCode).toBe(200);
    const phrases = list.json().phrases as { id: number; text: string }[];
    expect(phrases).toHaveLength(3);
    const target = phrases[2]!;
    const feedback = (accepted: boolean) =>
      inject(
        s.t,
        s.agentCookie,
        'POST',
        `/api/chats/${enc(JID)}/ai/phrases/${target.id}/feedback`,
        { accepted },
      );
    expect((await feedback(true)).statusCode).toBe(204);
    expect((await feedback(true)).statusCode).toBe(204);
    expect((await feedback(false)).statusCode).toBe(204);
    const after = (
      await inject(s.t, s.agentCookie, 'GET', `/api/chats/${enc(JID)}/ai/phrases`)
    ).json();
    expect(after.phrases[0].id).toBe(target.id);
    expect(s.phrases.admin().phrases.find((p) => p.id === target.id)?.uses).toBe(1);
    expect(
      (
        await inject(
          s.t,
          s.agentCookie,
          'POST',
          `/api/chats/${enc(JID)}/ai/phrases/9999/feedback`,
          { accepted: true },
        )
      ).statusCode,
    ).toBe(404);
  });

  it("answers 404 outside the caller's inboxes", async () => {
    const s = await setup({ inboxes: 2 });
    const other = getChats(s.t.ctx).upsertFromWa({ jid: JID, type: 'dm', name: 'Nurul' }, 2);
    const res = await inject(s.t, s.agentCookie, 'GET', `/api/chats/${enc(other.jid)}/ai/phrases`);
    expect(res.statusCode).toBe(404);
  });

  it('lets only admins manage phrases; edits become the admin’s and are audited without text', async () => {
    const s = await setup();
    expect((await inject(s.t, s.agentCookie, 'GET', '/api/ai/phrases')).statusCode).toBe(403);
    // An empty agentId means the agent of inbox 1.
    const byDefault = await inject(s.t, s.adminCookie, 'GET', '/api/ai/phrases?agentId=');
    expect(byDefault.json().agentId).toBe(s.phrases.admin().agentId);
    const added = await inject(s.t, s.adminCookie, 'POST', '/api/ai/phrases', {
      text: 'We open at 8am daily.',
      language: 'en',
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ source: 'admin', fact: true, uses: 0 });
    const id = added.json().id as number;
    const edited = await inject(s.t, s.adminCookie, 'PUT', `/api/ai/phrases/${id}`, {
      text: 'Kami buka jam 8 pagi.',
      language: 'ms',
    });
    expect(edited.json()).toMatchObject({
      text: 'Kami buka jam 8 pagi.',
      language: 'ms',
      source: 'admin',
    });
    expect(
      (
        await inject(s.t, s.adminCookie, 'PUT', `/api/ai/phrases/${id}`, {
          text: 'Hi',
          language: 'en',
        })
      ).statusCode,
    ).toBe(400);
    expect((await inject(s.t, s.adminCookie, 'DELETE', `/api/ai/phrases/${id}`)).statusCode).toBe(
      204,
    );
    expect((await inject(s.t, s.adminCookie, 'DELETE', `/api/ai/phrases/${id}`)).statusCode).toBe(
      404,
    );
    const audits = s.t.ctx.db
      .prepare("SELECT action, meta FROM audit_log WHERE action LIKE 'ai.phrase.%' ORDER BY id")
      .all() as { action: string; meta: string }[];
    expect(audits.map((a) => a.action)).toEqual([
      'ai.phrase.create',
      'ai.phrase.update',
      'ai.phrase.delete',
    ]);
    expect(audits.map((a) => a.meta).join('')).not.toContain('8am');
  });

  it('starts Rebuild now in the background and shows building', async () => {
    const s = await setup();
    let finish!: (value: unknown) => void;
    vi.mocked(s.provider.draft!).mockImplementationOnce(
      () => new Promise((r) => (finish = r)) as never,
    );
    const res = await inject(s.t, s.adminCookie, 'POST', '/api/ai/phrases/rebuild', {});
    expect(res.json().state).toBe('building');
    expect((await inject(s.t, s.adminCookie, 'GET', '/api/ai/phrases')).json().status.state).toBe(
      'building',
    );
    finish({ output: BUILT, model: 'gpt-6-luna' });
    await vi.waitFor(() => expect(s.phrases.admin().status.state).toBe('ready'));
    expect(s.phrases.admin().status.trigger).toBe('manual');
  });

  it('names the fast model per connection, and falls back to it when the mode changed', async () => {
    const s = await setup();
    const ai = s.t.ctx.services.ai!;
    setReplySuggestionsModel(s.t.ctx, 'gpt-6.1-sol', s.actor);
    ai.saveConnection(
      { mode: 'claude', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-0000000' },
      s.actor,
    );
    expect(ai.suggestModelInfo()).toMatchObject({
      model: 'gpt-6.1-sol',
      fastModel: 'claude-haiku-5-5',
      agentModel: 'claude-sonnet-5-5',
      resolved: 'claude-haiku-5-5',
    });
    expect(ai.isSuggestModel('claude-opus-5-5')).toBe(true);
    expect(ai.isSuggestModel('gpt-6.1-sol')).toBe(false);
    ai.saveConnection({ mode: 'api', model: 'gpt-5.5', apiKey: 'sk-test-00000000' }, s.actor);
    expect(ai.suggestModelInfo()).toMatchObject({
      fastModel: 'gpt-4.1-mini',
      agentModel: 'gpt-5.5',
    });
    expect(ai.suggestModelInfo().models).toEqual(['gpt-4.1-mini', 'gpt-5.5', 'gpt-4.1']);
    setReplySuggestionsModel(s.t.ctx, 'agent', s.actor);
    expect(ai.suggestModelInfo().resolved).toBe('gpt-5.5');
  });

  it('saves the model for suggestions only for a model of the connection', async () => {
    const s = await setup();
    const info = (
      await inject(s.t, s.adminCookie, 'GET', '/api/ai/reply-suggestions/model')
    ).json();
    expect(info).toMatchObject({ model: 'fast', fastModel: 'gpt-6-luna', resolved: 'gpt-6-luna' });
    expect(info.models).toContain('gpt-6.1-sol');
    expect(
      (
        await inject(s.t, s.adminCookie, 'PUT', '/api/ai/reply-suggestions', {
          model: 'gpt-6.1-sol',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await inject(s.t, s.adminCookie, 'GET', '/api/ai/reply-suggestions/model')).json(),
    ).toMatchObject({
      model: 'gpt-6.1-sol',
      resolved: 'gpt-6.1-sol',
    });
    expect(
      (
        await inject(s.t, s.adminCookie, 'PUT', '/api/ai/reply-suggestions', {
          model: 'claude-opus-5-5',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await inject(s.t, s.agentCookie, 'GET', '/api/ai/reply-suggestions/model')).statusCode,
    ).toBe(403);
    // A chosen model answers the drafts too.
    await inject(s.t, s.agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/complete`, {
      text: 'Hi there ',
    });
    const [settings, , , options] = vi.mocked(s.provider.draft!).mock.calls.at(-1)!;
    expect(settings.model).toBe('gpt-6.1-sol');
    expect(options).toMatchObject({ fast: false });
  });
});

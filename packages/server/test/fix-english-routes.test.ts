import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { TEAM_WORDS_MAX } from '@ezychat/shared';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { getChats } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders } from './auth-helpers.js';

const JID = '60126677889@s.whatsapp.net';
const GROUP = '120363025550001@g.us';
const DRAFT = 'Hi, your order have been ship. pls check you email.';
const FIXED = 'Hi, your order has been shipped. Please check your email.';

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

async function setup(
  opts: { inboxes?: number; listen?: boolean; connected?: boolean; noKey?: boolean } = {},
) {
  const provider: AiProvider = {
    generate: vi.fn(),
    draft: vi.fn().mockResolvedValue({ output: { corrected: FIXED }, model: 'gpt-test' }),
    connection: () =>
      opts.noKey
        ? { state: 'signed_out', loginUrl: null, error: null }
        : opts.connected === false
          ? { state: 'expired', loginUrl: null, error: null }
          : { state: 'connected', loginUrl: null, error: null },
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  const t = await makeTestApp({
    ...(opts.inboxes ? { maxInboxes: 3, inboxes: opts.inboxes } : {}),
    ...(opts.listen ? { listen: true } : {}),
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.ai = createAiService(ctx, { provider });
    },
  });
  open.push(t);
  const auth = t.ctx.services.auth!;
  const user = (username: string, role: 'admin' | 'agent') =>
    auth.createUser({
      username,
      displayName: username === 'admin' ? 'Aisyah' : 'Daniel',
      role,
      password: 'password123',
      mustChangePassword: false,
    });
  const admin = user('admin', 'admin');
  const agent = user('agent', 'agent');
  const cookie = (id: number) =>
    `sid=${auth.createSession(id, { ip: '127.0.0.1', userAgent: 't' })}`;
  t.ctx.services.ai!.saveConnection({ mode: 'chatgpt', model: '' }, { userId: admin.id, ip: null });
  t.ctx.services.ai!.saveMember(
    { displayName: 'Aina', enabled: false, instructions: '' },
    { userId: admin.id, ip: null },
  );
  t.ctx.services.ai!.addText(
    null,
    { name: 'Menu', text: 'Nasi Lemak Ayam RM12. Kopi O RM3.50, Teh Tarik RM4.' },
    { userId: admin.id, ip: null },
  );
  const chats = getChats(t.ctx);
  chats.upsertFromWa({ jid: JID, type: 'dm', name: 'Nurul' }, 1);
  chats.upsertFromWa({ jid: GROUP, type: 'group', name: 'Regulars' }, 1);
  return { t, provider, adminCookie: cookie(admin.id), agentCookie: cookie(agent.id) };
}

const enc = encodeURIComponent;
const inject = (
  t: TestApp,
  cookie: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers: authHeaders(cookie), ...(payload ? { payload } : {}) });
const auditMeta = (t: TestApp, action: string) =>
  (
    t.ctx.db.prepare('SELECT meta FROM audit_log WHERE action = ? ORDER BY id').all(action) as {
      meta: string;
    }[]
  ).map((row) => JSON.parse(row.meta));

describe('Fix English routes', () => {
  it('shows any signed-in user the status: spelling and grammar on', async () => {
    const { t, agentCookie } = await setup();
    const res = await inject(t, agentCookie, 'GET', '/api/fix-english');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      connected: true,
      spelling: 'on',
      grammar: 'on',
      upgraded: false,
    });
  });

  it('keeps spelling on without an AI connection, and says why grammar is off', async () => {
    const none = await setup({ noKey: true });
    expect(
      (await inject(none.t, none.agentCookie, 'GET', '/api/fix-english')).json(),
    ).toMatchObject({ spelling: 'on', grammar: 'none', connected: false });
    const expired = await setup({ connected: false });
    expect(
      (await inject(expired.t, expired.agentCookie, 'GET', '/api/fix-english')).json(),
    ).toMatchObject({ spelling: 'on', grammar: 'unavailable' });
    const res = await inject(
      expired.t,
      expired.agentCookie,
      'POST',
      `/api/chats/${enc(JID)}/ai/fix-grammar`,
      { text: DRAFT },
    );
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('ai_unavailable');
    expect(expired.provider.draft).not.toHaveBeenCalled();
  });

  it('lets only an admin change the switch, audits it, and turns both checks off', async () => {
    const { t, provider, adminCookie, agentCookie } = await setup();
    expect(
      (await inject(t, agentCookie, 'PUT', '/api/ai/fix-english', { enabled: false })).statusCode,
    ).toBe(403);
    const res = await inject(t, adminCookie, 'PUT', '/api/ai/fix-english', { enabled: false });
    expect(res.json()).toMatchObject({ enabled: false, spelling: 'off', grammar: 'off' });
    // Saving the same value again is not a change.
    await inject(t, adminCookie, 'PUT', '/api/ai/fix-english', { enabled: false });
    expect(auditMeta(t, 'fix_english.update')).toEqual([{ before: true, after: false }]);
    const off = await inject(t, agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/fix-grammar`, {
      text: DRAFT,
    });
    expect(off.statusCode).toBe(409);
    expect(off.json().error.code).toBe('fix_english_off');
    expect(provider.draft).not.toHaveBeenCalled();
    expect(
      (await inject(t, adminCookie, 'PUT', '/api/ai/fix-english', { enabled: 'yes' })).statusCode,
    ).toBe(400);
  });

  it('returns grammar marks on the original positions, in direct chats and groups', async () => {
    const { t, provider, agentCookie } = await setup();
    for (const jid of [JID, GROUP]) {
      const res = await inject(t, agentCookie, 'POST', `/api/chats/${enc(jid)}/ai/fix-grammar`, {
        text: DRAFT,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('checked');
      expect(
        body.issues.map((i: { original: string; replacement: string }) => [
          i.original,
          i.replacement,
        ]),
      ).toEqual([
        ['have', 'has'],
        ['ship', 'shipped'],
        ['pls', 'Please'],
        ['you', 'your'],
      ]);
      for (const issue of body.issues)
        expect(DRAFT.slice(issue.start, issue.end)).toBe(issue.original);
    }
    // The model got the fixed rules and only the text; the cache key never holds the chat.
    const [, , prompt, options] = vi.mocked(provider.draft!).mock.calls[0]!;
    expect(JSON.parse(prompt.input)).toEqual({ text: DRAFT });
    expect(prompt.instructions).toContain('only grammar, spelling and punctuation');
    expect(prompt.cacheId).toMatch(/#fix-english$/);
    expect(prompt.cacheId).not.toContain(JID);
    expect(options).toMatchObject({ maxOutputTokens: 3_000 });
  });

  it('skips Malay, Chinese and one-word text without calling the AI', async () => {
    const { t, provider, agentCookie } = await setup();
    const check = async (text: string) =>
      (
        await inject(t, agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/fix-grammar`, { text })
      ).json();
    expect(await check('Boleh, saya check dulu ya')).toEqual({
      status: 'skipped',
      reason: 'not_english',
    });
    expect(await check('你好 i will check')).toEqual({ status: 'skipped', reason: 'not_english' });
    expect(await check('ok')).toEqual({ status: 'skipped', reason: 'too_short' });
    expect(provider.draft).not.toHaveBeenCalled();
  });

  it('drops changes to numbers and rewrites', async () => {
    const { t, provider, agentCookie } = await setup();
    vi.mocked(provider.draft!).mockResolvedValueOnce({
      output: { corrected: 'The price are RM15 for two pax.' },
      model: 'gpt-test',
    });
    const res = await inject(t, agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/fix-grammar`, {
      text: 'The price are RM12 for 2 pax.',
    });
    expect(res.json()).toEqual({ status: 'checked', issues: [] });
  });

  it('answers 503 when the AI fails, and logs counts only', async () => {
    const { t, provider, agentCookie } = await setup();
    vi.mocked(provider.draft!).mockRejectedValueOnce(
      Object.assign(new Error(`echo ${DRAFT}`), { status: 500 }),
    );
    const res = await inject(t, agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/fix-grammar`, {
      text: DRAFT,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).not.toContain('order');
  });

  it("answers 404 outside the caller's inboxes and 400 for an empty text", async () => {
    const { t, provider, agentCookie } = await setup({ inboxes: 2 });
    const other = getChats(t.ctx).upsertFromWa({ jid: JID, type: 'dm', name: 'Nurul' }, 2);
    const res = await inject(
      t,
      agentCookie,
      'POST',
      `/api/chats/${enc(other.jid)}/ai/fix-grammar`,
      {
        text: DRAFT,
      },
    );
    expect(res.statusCode).toBe(404);
    expect(
      (await inject(t, agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/fix-grammar`, { text: '' }))
        .statusCode,
    ).toBe(400);
    expect(provider.draft).not.toHaveBeenCalled();
  });

  it('rate-limits the grammar check at 120 a minute per user', async () => {
    const { t, agentCookie } = await setup();
    for (let i = 0; i < 120; i++)
      await inject(t, agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/fix-grammar`, { text: 'ok' });
    const limited = await inject(t, agentCookie, 'POST', `/api/chats/${enc(JID)}/ai/fix-grammar`, {
      text: 'ok',
    });
    expect(limited.statusCode).toBe(429);
  });

  it('aborts the model call when the client disconnects', async () => {
    const { t, provider, agentCookie } = await setup({ listen: true });
    let seen: AbortSignal | undefined;
    vi.mocked(provider.draft!).mockImplementationOnce(
      (_s, _k, _p, _o, signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          signal.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          );
        }),
    );
    const base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    const client = new AbortController();
    const request = fetch(`${base}/api/chats/${enc(JID)}/ai/fix-grammar`, {
      method: 'POST',
      headers: { cookie: agentCookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ text: DRAFT }),
      signal: client.signal,
    }).catch(() => null);
    await vi.waitFor(() => expect(seen).toBeDefined());
    client.abort();
    await request;
    await vi.waitFor(() => expect(seen!.aborted).toBe(true));
  });

  it('answers 403 while the access gate is closed', async () => {
    const { t, agentCookie } = await setup();
    t.ctx.access.close({ code: 'licence_expired' });
    expect((await inject(t, agentCookie, 'GET', '/api/fix-english')).statusCode).toBe(403);
  });
});

describe('team words', () => {
  it('lists the Business context words (not Internal items) with the team words', async () => {
    const { t, agentCookie } = await setup();
    t.ctx.services.ai!.addText(
      null,
      { name: 'Secret', text: 'Supplier Zarqonia margin', internal: true },
      { userId: 1, ip: null },
    );
    const res = await inject(t, agentCookie, 'GET', '/api/fix-english/words');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.words).toEqual([]);
    expect(body.businessWords).toEqual(expect.arrayContaining(['nasi', 'lemak', 'teh', 'tarik']));
    expect(body.businessWords).not.toContain('zarqonia');
    // Numbers and one-letter words are not words.
    expect(body.businessWords.some((w: string) => /\d/.test(w) || w.length < 2)).toBe(false);
  });

  it('lets any user add a word, keeps one per spelling, and audits it', async () => {
    const { t, agentCookie } = await setup();
    const added = await inject(t, agentCookie, 'POST', '/api/fix-english/words', {
      word: '  cendol ',
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().words).toEqual([
      { word: 'cendol', addedBy: 'Daniel', createdAt: expect.any(Number) },
    ]);
    const again = await inject(t, agentCookie, 'POST', '/api/fix-english/words', {
      word: 'Cendol',
    });
    expect(again.json().words).toHaveLength(1);
    expect(auditMeta(t, 'fix_english.word_add')).toEqual([{ word: 'cendol' }]);
    for (const word of ['RM12', 'https://x.example', '', 'x'.repeat(41)])
      expect(
        (await inject(t, agentCookie, 'POST', '/api/fix-english/words', { word })).statusCode,
      ).toBe(400);
  });

  it('lets only an admin remove a word', async () => {
    const { t, adminCookie, agentCookie } = await setup();
    await inject(t, agentCookie, 'POST', '/api/fix-english/words', { word: 'kopitiam' });
    expect(
      (await inject(t, agentCookie, 'DELETE', '/api/fix-english/words/kopitiam')).statusCode,
    ).toBe(403);
    const removed = await inject(t, adminCookie, 'DELETE', '/api/fix-english/words/KOPITIAM');
    expect(removed.statusCode).toBe(200);
    expect(removed.json().words).toEqual([]);
    expect(auditMeta(t, 'fix_english.word_remove')).toEqual([{ word: 'KOPITIAM' }]);
    expect(
      (await inject(t, adminCookie, 'DELETE', '/api/fix-english/words/kopitiam')).statusCode,
    ).toBe(404);
  });

  it(`stops at ${TEAM_WORDS_MAX} words`, async () => {
    const { t, agentCookie } = await setup();
    const insert = t.ctx.db.prepare(
      'INSERT INTO fix_english_words (word, added_by, created_at) VALUES (?, NULL, 0)',
    );
    for (let i = 0; i < TEAM_WORDS_MAX; i++)
      insert.run(`word${String.fromCharCode(97 + (i % 26))}${i}`);
    const full = await inject(t, agentCookie, 'POST', '/api/fix-english/words', { word: 'cendol' });
    expect(full.statusCode).toBe(409);
  });
});

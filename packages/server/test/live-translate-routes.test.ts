// Live translate (docs/live-translate.md): admin switch and limit, per-chat state, translations with
// the cache, the 70 % rule and the guard, drafts, the send check, and access (404 outside the inbox,
// limited agents). The AI provider is a mock: no test calls a real model.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatTranslateState,
  LiveTranslateStatus,
  MessageSchema,
  TranslateDraft,
  TranslationsResponse,
  type User,
} from '@ezychat/shared';
import type { AiProvider } from '../src/ai/provider-types.js';
import { createAiService } from '../src/ai/service.js';
import { getChats } from '../src/wa-bridge/index.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const CN = '60123000111@s.whatsapp.net'; // a customer writing Chinese
const MS = '60123000222@s.whatsapp.net'; // a customer writing Malay
const G = '120363000000000001@g.us';
const MEMBER = '60175550001@s.whatsapp.net';
const enc = encodeURIComponent;

const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** Mock translations by source text; anything else gets "[<target>] <text>". */
const DICT: Record<string, string> = {
  '你好，请问这个多少钱？': 'Hai, berapa harga ini?',
  '可以明天送到吗？': 'Boleh hantar esok?',
  'Harga RM1,260.00, hantar esok.': '价格RM1,260.00，明天送达。',
  'Harga RM1,260.00 sahaja.': '价格RM4,260.00。',
};

type Mode = 'ok' | 'fail' | 'drop';

const open: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of open.splice(0)) await t.close();
});

async function setup(opts: { connected?: boolean } = {}) {
  let mode: Mode = 'ok';
  const draft = vi.fn(async (_settings: unknown, _key: unknown, prompt: { input: string }) => {
    if (mode === 'fail') throw Object.assign(new Error('boom'), { status: 500 });
    const input = JSON.parse(prompt.input) as {
      target: { code: string };
      items: Array<{ id: string; text: string }>;
    };
    const items = input.items
      .filter((_, i) => mode !== 'drop' || i > 0)
      .map((i) => ({
        id: i.id,
        translation: DICT[i.text] ?? `[${input.target.code}] ${i.text}`,
        detected: /\p{Script=Han}/u.test(i.text) ? 'zh' : 'ms',
      }));
    return { output: { items }, model: 'gpt-test-mini' };
  });
  const provider: AiProvider = {
    generate: vi.fn(),
    draft: draft as unknown as AiProvider['draft'],
    connection: () =>
      opts.connected === false
        ? { state: 'expired', loginUrl: null, error: null }
        : { state: 'connected', loginUrl: null, error: null },
    login: vi.fn(),
    logout: vi.fn(),
    shutdown: vi.fn(async () => {}),
  };
  const t = await makeTestApp({
    beforeBuild: async (ctx) => {
      await ctx.services.ai!.shutdown();
      ctx.services.ai = createAiService(ctx, { provider });
    },
  });
  open.push(t);
  const admin = await createUserAndLogin(t, { role: 'admin', username: 'aisyah' });
  const agent = await createUserAndLogin(t, { role: 'agent', username: 'daniel' });
  t.ctx.services.ai!.saveConnection(
    { mode: 'chatgpt', model: '' },
    { userId: admin.user.id, ip: null },
  );
  const wa = t.inboxWa(1);
  wa.simulateIncoming({ chatJid: CN, body: '你好，请问这个多少钱？', senderName: 'Mei' });
  wa.simulateIncoming({ chatJid: CN, body: '可以明天送到吗？', senderName: 'Mei' });
  wa.simulateIncoming({
    chatJid: MS,
    body: 'Boleh saya tahu harga barang ini?',
    senderName: 'Ali',
  });
  wa.simulateIncoming({ chatJid: G, body: '大家好', senderJid: MEMBER, senderName: 'Ben' });
  await settle();
  // My language: Malay for both (the app language would give English).
  for (const u of [admin, agent])
    await inject(t, 'PATCH', '/api/me', u.cookie, { translateLanguage: 'ms' });
  return {
    t,
    draft,
    admin,
    agent,
    setMode: (m: Mode) => {
      mode = m;
    },
  };
}

function inject(
  t: TestApp,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  cookie: string,
  payload?: unknown,
) {
  return t.app.inject({
    method,
    url,
    headers: authHeaders(cookie),
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

function messageIds(t: TestApp, jid: string): string[] {
  return (
    t.ctx.db
      .prepare('SELECT id FROM messages WHERE chat_jid = ? ORDER BY timestamp')
      .all(jid) as Array<{ id: string }>
  ).map((r) => r.id);
}

async function translate(t: TestApp, cookie: string, jid: string, ids: string[], target = 'ms') {
  const res = await inject(t, 'POST', `/api/chats/${enc(jid)}/translations`, cookie, {
    messageIds: ids,
    target,
  });
  return { res, body: res.statusCode === 200 ? TranslationsResponse.parse(res.json()) : null };
}

const auditMeta = (t: TestApp, action: string) =>
  (
    t.ctx.db.prepare('SELECT meta FROM audit_log WHERE action = ? ORDER BY id').all(action) as {
      meta: string;
    }[]
  ).map((row) => JSON.parse(row.meta) as unknown);

describe('Live translate settings', () => {
  it('is on for everyone with 200 a day by default; only admins change it, audited before/after', async () => {
    const { t, admin, agent } = await setup();
    const status = LiveTranslateStatus.parse(
      (await inject(t, 'GET', '/api/live-translate', agent.cookie)).json(),
    );
    expect(status).toEqual({ enabled: true, dailyLimit: 200, connected: true, usedToday: 0 });
    expect(
      (await inject(t, 'PUT', '/api/live-translate/settings', agent.cookie, { enabled: false }))
        .statusCode,
    ).toBe(403);
    const res = await inject(t, 'PUT', '/api/live-translate/settings', admin.cookie, {
      dailyLimit: 5,
    });
    expect(res.json()).toMatchObject({
      enabled: true,
      dailyLimit: 5,
      peopleToday: 0,
      translationsToday: 0,
    });
    // the same values again are no change
    await inject(t, 'PUT', '/api/live-translate/settings', admin.cookie, { dailyLimit: 5 });
    expect(auditMeta(t, 'settings.live_translate')).toEqual([
      { before: { enabled: true, dailyLimit: 200 }, after: { enabled: true, dailyLimit: 5 } },
    ]);
    expect(
      (await inject(t, 'PUT', '/api/live-translate/settings', admin.cookie, { dailyLimit: -1 }))
        .statusCode,
    ).toBe(400);
  });

  it('answers 409 translate_off everywhere while an admin switched it off', async () => {
    const { t, admin, agent, draft } = await setup();
    await inject(t, 'PUT', '/api/live-translate/settings', admin.cookie, { enabled: false });
    const url = `/api/chats/${enc(CN)}`;
    for (const [method, path, body] of [
      ['GET', `${url}/live-translate`, undefined],
      ['PUT', `${url}/live-translate`, { on: true }],
      ['POST', `${url}/translations`, { messageIds: ['x'], target: 'ms' }],
      ['POST', `${url}/translate-draft`, { text: 'Hai', target: 'zh' }],
    ] as const) {
      const res = await inject(t, method, path, agent.cookie, body);
      expect(res.statusCode, path).toBe(409);
      expect(res.json().error.code).toBe('translate_off');
    }
    expect(draft).not.toHaveBeenCalled();
  });
});

describe('My language (PATCH /api/me)', () => {
  it('saves My language and Send without preview, and audits a language change only', async () => {
    const { t, agent } = await setup();
    const me = await inject(t, 'GET', '/api/me', agent.cookie);
    expect(me.json()).toMatchObject({ translateLanguage: 'ms', sendWithoutPreview: false });
    const res = await inject(t, 'PATCH', '/api/me', agent.cookie, { sendWithoutPreview: true });
    expect(res.json()).toMatchObject({ translateLanguage: 'ms', sendWithoutPreview: true });
    await inject(t, 'PATCH', '/api/me', agent.cookie, { translateLanguage: null });
    expect(auditMeta(t, 'user.translate_language')).toEqual([
      { language: 'ms' },
      { language: 'ms' },
      { language: null },
    ]);
    expect(
      (await inject(t, 'PATCH', '/api/me', agent.cookie, { translateLanguage: 'fr' })).statusCode,
    ).toBe(400);
  });
});

describe('chat state', () => {
  it('detects the customer language from the script, keeps my switch mine and shares a chosen language', async () => {
    const { t, admin, agent } = await setup();
    const url = `/api/chats/${enc(CN)}/live-translate`;
    expect(ChatTranslateState.parse((await inject(t, 'GET', url, agent.cookie)).json())).toEqual({
      on: false,
      customerLanguage: null,
      detected: 'zh',
      mixed: null,
      outgoingLanguage: null,
      outgoingDetected: null,
    });
    const on = await inject(t, 'PUT', url, agent.cookie, { on: true, customerLanguage: 'en' });
    expect(on.json()).toMatchObject({ on: true, customerLanguage: 'en' });
    // the admin sees the shared language, not the agent's switch
    expect((await inject(t, 'GET', url, admin.cookie)).json()).toMatchObject({
      on: false,
      customerLanguage: 'en',
    });
    // a group's language is the outgoing one; a customer language is ignored there
    const group = `/api/chats/${enc(G)}/live-translate`;
    const g = await inject(t, 'PUT', group, agent.cookie, {
      customerLanguage: 'en',
      outgoingLanguage: 'zh',
    });
    expect(g.json()).toEqual({
      on: false,
      customerLanguage: null,
      detected: null,
      mixed: null,
      outgoingLanguage: 'zh',
      outgoingDetected: 'zh',
    });
  });
});

describe('translations', () => {
  it('translates the customer messages once, then answers from the cache for everyone', async () => {
    const { t, admin, agent, draft } = await setup();
    const ids = [...messageIds(t, CN), 'not-a-message'];
    const first = await translate(t, agent.cookie, CN, ids);
    expect(first.body!.translations).toEqual({
      [ids[0]!]: { status: 'ok', text: 'Hai, berapa harga ini?', from: 'zh' },
      [ids[1]!]: { status: 'ok', text: 'Boleh hantar esok?', from: 'zh' },
    });
    expect(draft).toHaveBeenCalledTimes(1);
    // a teammate with the same language costs nothing
    const again = await translate(t, admin.cookie, CN, ids.slice(0, 2));
    expect(again.body!.translations[ids[0]!]).toMatchObject({ status: 'ok' });
    expect(draft).toHaveBeenCalledTimes(1);
    const status = (await inject(t, 'GET', '/api/live-translate', admin.cookie)).json();
    expect(status).toMatchObject({ usedToday: 0, peopleToday: 1, translationsToday: 2 });
    expect((await inject(t, 'GET', '/api/live-translate', agent.cookie)).json()).toMatchObject({
      usedToday: 2,
    });
  });

  it('keeps a message already 70 % in My language and never calls the model for it', async () => {
    const { t, agent, draft } = await setup();
    const res = await translate(t, agent.cookie, MS, messageIds(t, MS));
    expect(Object.values(res.body!.translations)).toEqual([{ status: 'same_language' }]);
    expect(draft).not.toHaveBeenCalled();
  });

  it('never shows a translation that changed a protected item', async () => {
    const { t, agent } = await setup();
    t.inboxWa(1).simulateIncoming({
      chatJid: CN,
      body: 'Harga RM1,260.00 sahaja.',
      senderName: 'Mei',
    });
    await settle();
    const id = messageIds(t, CN).at(-1)!;
    const res = await translate(t, agent.cookie, CN, [id], 'zh');
    expect(res.body!.translations[id]).toEqual({ status: 'unsafe', from: 'ms' });
  });

  it('stops at the daily limit and says so per message', async () => {
    const { t, admin, agent, draft } = await setup();
    await inject(t, 'PUT', '/api/live-translate/settings', admin.cookie, { dailyLimit: 1 });
    const ids = messageIds(t, CN);
    const res = await translate(t, agent.cookie, CN, ids);
    expect(res.body!.translations[ids[0]!]!.status).toBe('ok');
    expect(res.body!.translations[ids[1]!]).toEqual({ status: 'limit' });
    const draftRes = await inject(
      t,
      'POST',
      `/api/chats/${enc(CN)}/translate-draft`,
      agent.cookie,
      {
        text: 'Boleh',
        target: 'zh',
      },
    );
    expect(draftRes.statusCode).toBe(429);
    expect(draftRes.json().error.code).toBe('translate_limit');
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it('shows failures without counting them, and ai_unavailable without AI', async () => {
    const failing = await setup();
    failing.setMode('fail');
    const ids = messageIds(failing.t, CN);
    const res = await translate(failing.t, failing.agent.cookie, CN, ids);
    expect(Object.values(res.body!.translations)).toEqual([
      { status: 'failed' },
      { status: 'failed' },
    ]);
    failing.setMode('drop');
    const dropped = await translate(failing.t, failing.agent.cookie, CN, ids);
    expect(dropped.body!.translations[ids[0]!]).toEqual({ status: 'failed' });
    expect(
      (await inject(failing.t, 'GET', '/api/live-translate', failing.agent.cookie)).json(),
    ).toMatchObject({ usedToday: 0 });

    const off = await setup({ connected: false });
    const offIds = messageIds(off.t, CN);
    const r = await translate(off.t, off.agent.cookie, CN, offIds);
    expect(Object.values(r.body!.translations)).toEqual([
      { status: 'ai_unavailable' },
      { status: 'ai_unavailable' },
    ]);
    const d = await inject(
      off.t,
      'POST',
      `/api/chats/${enc(CN)}/translate-draft`,
      off.agent.cookie,
      {
        text: 'Boleh',
        target: 'zh',
      },
    );
    expect(d.statusCode).toBe(503);
    expect(d.json().error.code).toBe('ai_unavailable');
    expect(off.draft).not.toHaveBeenCalled();
  });

  it('drops the cache of a message deleted for everyone', async () => {
    const { t, agent } = await setup();
    const ids = messageIds(t, CN);
    await translate(t, agent.cookie, CN, ids);
    const before = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM message_translations').get();
    expect(before).toEqual({ n: 2 });
    const msg = MessageSchema.parse(
      (await inject(t, 'GET', `/api/chats/${enc(CN)}/messages`, agent.cookie)).json().messages[0],
    );
    t.ctx.bus.emit('message:updated', { ...msg, id: ids[0]!, deletedAt: Date.now() });
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM message_translations').get()).toEqual({
      n: 1,
    });
  });
});

describe('draft and send', () => {
  async function draftOf(t: TestApp, cookie: string, text: string, jid = CN) {
    const res = await inject(t, 'POST', `/api/chats/${enc(jid)}/translate-draft`, cookie, {
      text,
      target: 'zh',
    });
    expect(res.statusCode).toBe(200);
    return TranslateDraft.parse(res.json());
  }

  it('translates a draft with its protected items, sends it and keeps what was typed', async () => {
    const { t, admin, agent } = await setup();
    const typed = 'Harga RM1,260.00, hantar esok.';
    const d = await draftOf(t, agent.cookie, typed);
    expect(d).toMatchObject({
      status: 'ok',
      translation: '价格RM1,260.00，明天送达。',
      from: 'ms',
      protected: ['RM1,260.00'],
    });
    if (d.status !== 'ok') throw new Error('refused');
    const send = await inject(t, 'POST', `/api/chats/${enc(CN)}/messages`, agent.cookie, {
      text: d.translation,
      clientId: 'c-1',
      translation: { draftId: d.draftId, typedText: typed, typedLanguage: 'ms' },
    });
    expect(send.statusCode).toBe(201);
    expect(MessageSchema.parse(send.json())).toMatchObject({
      body: '价格RM1,260.00，明天送达。',
      typed: { typedText: typed, typedLanguage: 'ms', sentLanguage: 'zh', edited: false },
      sentOriginal: false,
    });
    await settle();
    // everyone with the chat sees the typed record, also after WhatsApp's id replaced the local one
    const list = (await inject(t, 'GET', `/api/chats/${enc(CN)}/messages`, admin.cookie)).json()
      .messages as Array<{ body: string; typed?: { typedText: string } | null; id: string }>;
    const sent = list.find((m) => m.body === d.translation)!;
    expect(sent.id.startsWith('local-')).toBe(false);
    expect(sent.typed?.typedText).toBe(typed);
    // a translation of our own typed reply is never asked for
    const tr = await translate(t, admin.cookie, CN, [sent.id], 'en');
    expect(tr.body!.translations[sent.id]).toEqual({ status: 'same_language' });
  });

  it('refuses a draft whose translation changed a price, and a send whose text changed one', async () => {
    const { t, agent } = await setup();
    expect(await draftOf(t, agent.cookie, 'Harga RM1,260.00 sahaja.')).toEqual({
      status: 'refused',
      item: 'RM1,260.00',
      became: 'RM4,260.00',
    });
    const typed = 'Harga RM1,260.00, hantar esok.';
    const d = await draftOf(t, agent.cookie, typed);
    if (d.status !== 'ok') throw new Error('refused');
    const send = await inject(t, 'POST', `/api/chats/${enc(CN)}/messages`, agent.cookie, {
      text: '价格RM1,200.00，明天送达。',
      clientId: 'c-2',
      translation: { draftId: d.draftId, typedText: typed, typedLanguage: 'ms', edited: true },
    });
    expect(send.statusCode).toBe(400);
    expect(send.json().error).toEqual({
      code: 'translation_changed',
      message: 'RM1,260.00 became RM1,200.00. Nothing was sent.',
    });
    const missing = await inject(t, 'POST', `/api/chats/${enc(CN)}/messages`, agent.cookie, {
      text: '明天送达。',
      clientId: 'c-2b',
      translation: { draftId: d.draftId, typedText: typed, typedLanguage: 'ms', edited: true },
    });
    expect(missing.json().error.message).toBe('RM1,260.00 is missing. Nothing was sent.');
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM message_typed').get()).toEqual({ n: 0 });
  });

  it("refuses another person's or another chat's draft, and an unknown one", async () => {
    const { t, admin, agent } = await setup();
    const d = await draftOf(t, agent.cookie, 'Hantar esok');
    if (d.status !== 'ok') throw new Error('refused');
    const body = (clientId: string, draftId = d.draftId) => ({
      text: d.translation,
      clientId,
      translation: { draftId, typedText: 'Hantar esok', typedLanguage: 'ms' },
    });
    for (const [cookie, jid, payload] of [
      [admin.cookie, CN, body('x1')],
      [agent.cookie, MS, body('x2')],
      [agent.cookie, CN, body('x3', 'nope')],
    ] as const) {
      const res = await inject(t, 'POST', `/api/chats/${enc(jid)}/messages`, cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('translation_expired');
    }
  });

  it('marks Send original instead, and a model failure answers 503 translate_failed', async () => {
    const { t, agent, setMode } = await setup();
    const send = await inject(t, 'POST', `/api/chats/${enc(CN)}/messages`, agent.cookie, {
      text: 'Hantar esok',
      clientId: 'c-3',
      sentOriginal: true,
    });
    expect(MessageSchema.parse(send.json())).toMatchObject({ typed: null, sentOriginal: true });
    setMode('fail');
    const res = await inject(t, 'POST', `/api/chats/${enc(CN)}/translate-draft`, agent.cookie, {
      text: 'Hantar esok',
      target: 'zh',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('translate_failed');
  });
});

describe('access', () => {
  it('answers 404 for chats outside the chosen chats of a limited agent', async () => {
    const { t, admin } = await setup();
    const limited = await createUserAndLogin(t, { role: 'agent', username: 'partner' });
    const res = await inject(t, 'PUT', `/api/users/${limited.user.id}/chats`, admin.cookie, {
      scope: 'chosen',
      chats: [CN],
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await inject(t, 'GET', `/api/chats/${enc(CN)}/live-translate`, limited.cookie)).statusCode,
    ).toBe(200);
    for (const [method, path, body] of [
      ['GET', 'live-translate', undefined],
      ['PUT', 'live-translate', { on: true }],
      ['POST', 'translations', { messageIds: messageIds(t, MS), target: 'ms' }],
      ['POST', 'translate-draft', { text: 'Hai', target: 'zh' }],
    ] as const) {
      const r = await inject(t, method, `/api/chats/${enc(MS)}/${path}`, limited.cookie, body);
      expect(r.statusCode, path).toBe(404);
    }
  });

  it('never translates a message of another chat through this chat', async () => {
    const { t, agent, draft } = await setup();
    const other = messageIds(t, CN);
    const res = await translate(t, agent.cookie, MS, other);
    expect(res.body!.translations).toEqual({});
    expect(draft).not.toHaveBeenCalled();
  });

  it('needs a signed-in user and a valid body', async () => {
    const { t, agent } = await setup();
    expect((await t.app.inject({ method: 'GET', url: '/api/live-translate' })).statusCode).toBe(
      401,
    );
    const tooMany = await translate(
      t,
      agent.cookie,
      CN,
      Array.from({ length: 51 }, (_, i) => `m${i}`),
    );
    expect(tooMany.res.statusCode).toBe(400);
    expect(getChats(t.ctx).get(CN)).not.toBeNull();
  });
});

export type { User };

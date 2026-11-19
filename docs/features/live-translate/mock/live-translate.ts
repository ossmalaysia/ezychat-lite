import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireAdmin, requireUser } from '../../../../packages/server/src/auth/guards.js';
import { HttpError, parse } from '../../../../packages/server/src/http/errors.js';
import { audit } from '../../../../packages/server/src/db/audit.js';

/**
 * Proposed (live-translate): a stand-in for the future `/api/live-translate/*` routes. Translation is a
 * fixed phrase table (no model is ever called); anything not in the table gets a marked demo
 * translation. Everything lives in memory and is lost when the mock restarts.
 */

export const LANGS = ['ms', 'en', 'zh', 'id', 'ta', 'th', 'vi', 'ar', 'ja', 'ko'] as const;
export type Lang = (typeof LANGS)[number];
const Lang = z.enum(LANGS);

/** Mock-only scenario switch (the dashed "Mock only" strip in a chat). */
const SCENARIOS = [
  'normal',
  'slow',
  'error',
  'limit',
  'offline',
  'no_ai',
  'number_changed',
] as const;
type Scenario = (typeof SCENARIOS)[number];

interface Entry {
  /** Text per language. */
  t: Partial<Record<Lang, string>>;
}

/**
 * The demo phrase table: every seeded customer message and the Malay replies the walkthrough types.
 * The real feature asks the "Model for suggestions" for one JSON translation per item (no back-translation).
 */
const TABLE: Entry[] = [
  {
    t: {
      zh: '你好，请问可以送到 Gurney Drive 吗？',
      ms: 'Helo, boleh hantar ke Gurney Drive?',
      en: 'Hello, can you deliver to Gurney Drive?',
    },
  },
  {
    t: {
      ms: 'Boleh, kami hantar ke Gurney Drive. Penghantaran percuma untuk pesanan melebihi RM40.',
      zh: '可以，我们可以送到 Gurney Drive。订单满 RM40 免运费。',
      en: 'Yes, we deliver to Gurney Drive. Delivery is free for orders above RM40.',
    },
  },
  {
    t: {
      zh: '我们公司下个月有一个活动，大概 80 人。想订 Kopi O 和 Teh Tarik 各 40 杯，还有 Nasi Lemak Ayam 80 份。请问可以在 12 月 15 日早上 9 点前送到 Bayan Lepas 的办公室吗？地址是 Jalan Sultan Azlan Shah 12 号。如果可以，请把报价发到 weijie.tan@example.com，或者打给我 012-702 0388。谢谢！',
      ms: 'Syarikat kami ada acara bulan depan, kira-kira 80 orang. Kami mahu tempah Kopi O dan Teh Tarik 40 cawan setiap satu, serta 80 bungkus Nasi Lemak Ayam. Boleh hantar ke pejabat di Bayan Lepas sebelum 9 pagi pada 15 Disember? Alamatnya No. 12, Jalan Sultan Azlan Shah. Jika boleh, sila hantar sebut harga ke weijie.tan@example.com, atau telefon saya di 012-702 0388. Terima kasih!',
      en: 'Our company has an event next month, about 80 people. We would like 40 cups each of Kopi O and Teh Tarik, and 80 packs of Nasi Lemak Ayam. Can you deliver to our office in Bayan Lepas before 9am on 15 December? The address is No. 12, Jalan Sultan Azlan Shah. If so, please send the quotation to weijie.tan@example.com, or call me at 012-702 0388. Thank you!',
    },
  },
  {
    t: {
      zh: 'Ok noted 👍 我先 check with my boss，明天再 reply 你',
      ms: 'Ok, faham 👍 Saya semak dengan bos saya dulu, esok saya balas.',
      en: "Ok noted 👍 I'll check with my boss first and reply to you tomorrow.",
    },
  },
  {
    t: {
      ms: 'Boleh. Jumlahnya RM1,260.00 termasuk penghantaran. Saya hantar sebut harga hari ini.',
      zh: '可以。总额是 RM1,260.00，包括运费。我今天会把报价发给你。',
      en: 'Sure. The total is RM1,260.00 including delivery. I will send the quotation today.',
    },
  },
  {
    t: {
      ms: 'Terima kasih! Kami tunggu jawapan anda.',
      zh: '谢谢！我们等你的回复。',
      en: 'Thank you! We look forward to your reply.',
    },
  },
  {
    t: {
      en: 'Hi, do you do corporate gift boxes? We need 25 boxes delivered to Singapore by 20 Dec.',
      ms: 'Hai, adakah anda buat kotak hadiah korporat? Kami perlukan 25 kotak dihantar ke Singapura sebelum 20 Dis.',
      zh: '你好，你们有做企业礼盒吗？我们需要 25 盒，在 12 月 20 日前送到新加坡。',
    },
  },
  {
    t: {
      ms: 'Ya, ada. Satu kotak RM68 dan penghantaran ke Singapura RM120 untuk semua kotak.',
      en: 'Yes, we do. One box is RM68, and delivery to Singapore is RM120 for all the boxes.',
      zh: '有的。一盒 RM68，送到新加坡的运费是所有礼盒一共 RM120。',
    },
  },
  {
    t: {
      zh: '好的，那我要 2 盒 Kopi O 粉，明天可以来拿吗？',
      ms: 'Baiklah, saya mahu 2 kotak serbuk Kopi O. Boleh saya ambil esok?',
      en: 'OK, I would like 2 boxes of Kopi O powder. Can I pick them up tomorrow?',
    },
  },
  {
    t: {
      zh: '老板，下个星期可以先送 50 包 Kopi O 粉吗？价钱跟上次一样，一包 RM18？',
      ms: 'Bos, boleh hantar 50 bungkus serbuk Kopi O dulu minggu depan? Harga sama macam dulu, RM18 sebungkus?',
      en: 'Boss, can you send 50 packs of Kopi O powder first next week? Same price as last time, RM18 a pack?',
    },
  },
  {
    t: {
      en: 'Thank you for your message! Ah Seng Trading will reply soon 🙏',
      ms: 'Terima kasih atas mesej anda! Ah Seng Trading akan membalas tidak lama lagi 🙏',
      zh: '谢谢你的消息！Ah Seng Trading 会尽快回复 🙏',
    },
  },
];

const NAMES: Record<Lang, string> = {
  ms: 'Malay',
  en: 'English',
  zh: 'Chinese',
  id: 'Indonesian',
  ta: 'Tamil',
  th: 'Thai',
  vi: 'Vietnamese',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
};

const MALAY =
  /\b(saya|kami|boleh|tak|ada|nak|terima kasih|hantar|berapa|untuk|dengan|sila|esok|bila|datang|ambil)\b/i;
const CJK = /[一-鿿]/g;
const LATIN = /[A-Za-z]/g;

/**
 * Script first (Chinese, Tamil, Thai, Arabic, Japanese, Korean decide alone); Latin text by a word list here. The app
 * lets the model decide Latin-script languages in the same call that translates.
 */
export function detect(text: string): Lang | null {
  const cjk = (text.match(CJK) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  if (cjk >= 2 && cjk * 3 >= latin) return 'zh';
  if (/[஀-௿]/.test(text)) return 'ta';
  if (/[฀-๿]/.test(text)) return 'th';
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  if (latin < 3) return cjk >= 2 ? 'zh' : null;
  return MALAY.test(text) ? 'ms' : cjk >= 2 ? 'zh' : 'en';
}

/** Share of a message already in `my` language (rule: translate only below 70 %). */
export function shareIn(text: string, my: Lang): number {
  const cjk = (text.match(CJK) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  const letters = cjk + latin;
  if (letters === 0) return 1;
  if (my === 'zh') return cjk / letters;
  const latinPart = text.replace(CJK, ' ');
  const latinLang = MALAY.test(latinPart) ? 'ms' : 'en';
  return latinLang === my ? latin / letters : 0;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
function lookup(text: string, to: Lang): string | null {
  const n = norm(text);
  for (const e of TABLE) if (Object.values(e.t).some((v) => norm(v!) === n)) return e.t[to] ?? null;
  return null;
}

/**
 * Protected items (same list as Cloud): numbers, prices and amounts, dates and times in digits, links, emails, phone
 * numbers, @mentions, order and tracking codes (letters with digits) and emoji. Each must appear unchanged in the
 * translation (spaces ignored).
 */
export function protectedItems(text: string): string[] {
  const out = new Set<string>();
  const res = [
    /https?:\/\/\S+/g,
    /[\w.+-]+@[\w-]+\.[\w.]+/g,
    /@\S+/g,
    /RM\s?\d[\d,]*(?:\.\d+)?/gi,
    /\b0\d{1,2}-?\d{3,4}\s?\d{3,4}\b/g,
    /\b\d{1,2}[:/.]\d{2}(?:[/.]\d{2,4})?\b/g,
    /#\w+/g,
    /\b(?=\w*\d)(?=\w*[A-Za-z])[A-Za-z0-9-]{3,}\b/g,
    /\d[\d,]*(?:\.\d+)?/g,
    /\p{Extended_Pictographic}/gu,
  ];
  let rest = text;
  for (const re of res)
    rest = rest.replace(re, (m) => {
      out.add(m.replace(/\s/g, ''));
      return ' ';
    });
  return [...out];
}

/** The first protected item the translation lost, and what it became (for "RM 45.00 became RM 54.00"). */
export function changedItem(
  from: string,
  translated: string,
): { item: string; became: string } | null {
  const flat = translated.replace(/\s/g, '');
  const lost = protectedItems(from).find((item) => !flat.includes(item));
  if (!lost) return null;
  const extra = protectedItems(translated).find((item) => !protectedItems(from).includes(item));
  return { item: lost, became: extra ?? '—' };
}

function translate(text: string, to: Lang, scenario: Scenario): string {
  const hit = lookup(text, to);
  let out = hit ?? `(${NAMES[to]} · demo) ${text}`;
  // Mock only: a model that changed a price, to show the guard refusing it.
  if (scenario === 'number_changed') out = out.replace(/\d/, (d) => String((Number(d) + 3) % 10));
  return out;
}

interface ChatLanguage {
  /** Set by a teammate; wins over detection. Shared by the team (a fact about the customer). */
  chosen: Lang | null;
  /** Groups: the one language replies go out in (null = most common of the last 20 messages). */
  outgoing: Lang | null;
}

interface Typed {
  typed: string;
  typedLanguage: Lang;
  sentLanguage: Lang;
  edited: boolean;
  /** "Send original instead": sent as typed, no translation. */
  original: boolean;
}

const state = {
  enabled: true,
  dailyLimit: 200,
  scenario: 'normal' as Scenario,
  myLanguage: new Map<number, Lang>(),
  sendWithoutPreview: new Map<number, boolean>(),
  /** Per person and chat: the Live translate switch. */
  switches: new Set<string>(),
  /** Per chat (shared): the customer's language and a group's outgoing language. */
  chatLanguages: new Map<string, ChatLanguage>(),
  typed: new Map<string, Typed>(),
  used: new Map<number, number>(),
  /** Message id + target → translation (the app: `message_translations`), so a reload costs nothing. */
  cache: new Map<string, string>(),
};

const switchKey = (userId: number, jid: string) => `${userId}|${jid}`;
const typedKey = (jid: string, text: string) => `${jid}|${norm(text)}`;
const userOf = (req: FastifyRequest) => req.user!;

/** Default My language: the app language (en, ms, zh-CN). */
function myLanguage(userId: number, locale?: string): Lang {
  return (
    state.myLanguage.get(userId) ??
    (locale === 'ms' ? 'ms' : locale?.startsWith('zh') ? 'zh' : 'en')
  );
}

function recent(ctx: AppContext, jid: string, inboundOnly: boolean, limit: number) {
  return ctx.db
    .prepare(
      `SELECT body FROM messages WHERE chat_jid = ? ${inboundOnly ? 'AND from_me = 0' : ''} AND body IS NOT NULL ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(jid, limit) as Array<{ body: string }>;
}

function mostCommon(rows: Array<{ body: string }>): Lang | null {
  const counts = new Map<Lang, number>();
  for (const r of rows) {
    const l = detect(r.body);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The customer's language from their last 10 messages; `mixed` names a second language they also use. */
function detectedFor(ctx: AppContext, jid: string): { detected: Lang | null; mixed: Lang | null } {
  const rows = recent(ctx, jid, true, 10);
  const detected = mostCommon(rows);
  const mixed =
    detected === 'zh' &&
    rows.some(
      (r) => (r.body.match(CJK) ?? []).length >= 2 && /\b[a-z]{3,}\b.*\b[a-z]{3,}\b/i.test(r.body),
    )
      ? ('en' as const)
      : null;
  return { detected, mixed };
}

function connected(ctx: AppContext): boolean {
  return state.scenario !== 'no_ai' && ctx.services.ai?.status().connection.state === 'connected';
}

/** Each translated item costs one; cache hits cost nothing. */
function spend(userId: number) {
  const used = state.used.get(userId) ?? 0;
  if (state.scenario === 'limit' || (state.dailyLimit > 0 && used >= state.dailyLimit))
    throw new HttpError(429, 'translate_limit', 'Daily limit used');
  state.used.set(userId, used + 1);
}

function ready(ctx: AppContext) {
  if (!state.enabled) throw new HttpError(409, 'translate_off', 'Live translate is off');
  if (state.scenario === 'offline') throw new HttpError(503, 'offline', 'No connection');
  if (!connected(ctx)) throw new HttpError(503, 'ai_unavailable', 'Live translate needs AI');
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerLiveTranslate(app: FastifyInstance, ctx: AppContext): void {
  const status = (req: FastifyRequest) => {
    const user = userOf(req);
    const locale = (req.query as { locale?: string } | undefined)?.locale;
    return {
      enabled: state.enabled,
      dailyLimit: state.dailyLimit,
      connected: connected(ctx),
      scenario: state.scenario,
      myLanguage: myLanguage(user.id, locale),
      myLanguageSet: state.myLanguage.has(user.id),
      sendWithoutPreview: state.sendWithoutPreview.get(user.id) ?? false,
      usedByMe: state.used.get(user.id) ?? 0,
      usedToday: [...state.used.values()].reduce((a, b) => a + b, 0),
      peopleToday: state.used.size,
    };
  };
  app.get('/api/mock/live-translate', { preHandler: requireUser(ctx) }, async (req) => status(req));

  // The app: GET/PUT /api/live-translate/settings (admins write).
  app.put('/api/mock/live-translate/settings', { preHandler: requireAdmin(ctx) }, async (req) => {
    const body = parse(
      z.object({
        enabled: z.boolean().optional(),
        dailyLimit: z.number().int().min(0).max(10_000).optional(),
      }),
      req.body ?? {},
    );
    const before = { enabled: state.enabled, dailyLimit: state.dailyLimit };
    if (body.enabled !== undefined) state.enabled = body.enabled;
    if (body.dailyLimit !== undefined) state.dailyLimit = body.dailyLimit;
    audit(ctx.db, {
      userId: userOf(req).id,
      action: 'settings.live_translate',
      ip: req.ip,
      meta: { before, after: { enabled: state.enabled, dailyLimit: state.dailyLimit } },
    });
    return status(req);
  });

  // The app: PATCH /api/me {translateLanguage?, sendWithoutPreview?}.
  app.put('/api/mock/live-translate/me', { preHandler: requireUser(ctx) }, async (req) => {
    const body = parse(
      z.object({ myLanguage: Lang.optional(), sendWithoutPreview: z.boolean().optional() }),
      req.body ?? {},
    );
    const id = userOf(req).id;
    if (body.myLanguage) state.myLanguage.set(id, body.myLanguage);
    if (body.sendWithoutPreview !== undefined)
      state.sendWithoutPreview.set(id, body.sendWithoutPreview);
    return status(req);
  });

  app.put('/api/mock/live-translate/scenario', { preHandler: requireUser(ctx) }, async (req) => {
    state.scenario = parse(z.object({ scenario: z.enum(SCENARIOS) }), req.body ?? {}).scenario;
    if (state.scenario === 'normal') state.used.clear();
    state.cache.clear();
    return status(req);
  });

  const chatState = (req: FastifyRequest, jid: string) => {
    const lang = state.chatLanguages.get(jid) ?? { chosen: null, outgoing: null };
    const { detected, mixed } = detectedFor(ctx, jid);
    return {
      on: state.switches.has(switchKey(userOf(req).id, jid)),
      customerLanguage: lang.chosen,
      detected,
      mixed,
      outgoingLanguage: lang.outgoing,
      outgoingDetected: jid.endsWith('@g.us') ? mostCommon(recent(ctx, jid, false, 20)) : null,
    };
  };
  // The app: GET/PUT /api/chats/:jid/live-translate.
  app.get<{ Params: { jid: string } }>(
    '/api/mock/live-translate/chats/:jid',
    { preHandler: requireUser(ctx) },
    async (req) => chatState(req, req.params.jid),
  );
  app.put<{ Params: { jid: string } }>(
    '/api/mock/live-translate/chats/:jid',
    { preHandler: requireUser(ctx) },
    async (req) => {
      const body = parse(
        z.object({
          on: z.boolean().optional(),
          customerLanguage: Lang.nullable().optional(),
          outgoingLanguage: Lang.nullable().optional(),
        }),
        req.body ?? {},
      );
      const jid = req.params.jid;
      const key = switchKey(userOf(req).id, jid);
      if (body.on === true) state.switches.add(key);
      if (body.on === false) state.switches.delete(key);
      const prev = state.chatLanguages.get(jid) ?? { chosen: null, outgoing: null };
      state.chatLanguages.set(jid, {
        chosen: body.customerLanguage === undefined ? prev.chosen : body.customerLanguage,
        outgoing: body.outgoingLanguage === undefined ? prev.outgoing : body.outgoingLanguage,
      });
      return chatState(req, jid);
    },
  );

  /**
   * The app: POST /api/chats/:jid/translations {messageIds, target} (≤ 50 visible messages). Inbound text and our
   * replies without a typed record (the AI agent's, the phone's) are translated into `target`; replies sent through
   * Live translate answer with what was typed.
   */
  app.post<{ Params: { jid: string } }>(
    '/api/mock/live-translate/chats/:jid/messages',
    { preHandler: requireUser(ctx) },
    async (req) => {
      const body = parse(
        z.object({
          to: Lang,
          translate: z.boolean(),
          messages: z
            .array(z.object({ id: z.string(), body: z.string(), fromMe: z.boolean() }))
            .max(200),
        }),
        req.body ?? {},
      );
      const user = userOf(req);
      const out: Record<string, unknown> = {};
      for (const m of body.messages) {
        const typed = m.fromMe ? state.typed.get(typedKey(req.params.jid, m.body)) : undefined;
        if (typed) {
          out[m.id] = typed.original
            ? { kind: 'original', from: typed.typedLanguage }
            : {
                kind: 'written',
                original: typed.typed,
                from: typed.typedLanguage,
                to: typed.sentLanguage,
                edited: typed.edited,
              };
          continue;
        }
        if (!body.translate) continue;
        const from = detect(m.body);
        // Rule: translate only when less than 70 % of the text is already in My language.
        if (!from || shareIn(m.body, body.to) >= 0.7) continue;
        const key = `${m.id}|${body.to}`;
        const cached = state.cache.get(key);
        if (cached) {
          out[m.id] = { kind: 'translated', text: cached, from };
          continue;
        }
        if (!state.enabled) continue;
        const fail = (code: string) => (out[m.id] = { kind: 'failed', code, from });
        if (state.scenario === 'offline') {
          fail('offline');
          continue;
        }
        if (!connected(ctx)) {
          fail('ai_unavailable');
          continue;
        }
        if (state.scenario === 'error') {
          fail('error');
          continue;
        }
        try {
          spend(user.id);
        } catch {
          fail('translate_limit');
          continue;
        }
        const text = translate(m.body, body.to, state.scenario);
        // A translation that changed a protected item is never shown.
        if (changedItem(m.body, text)) {
          fail('unsafe');
          continue;
        }
        state.cache.set(key, text);
        out[m.id] = { kind: 'translated', text, from };
      }
      if (state.scenario === 'slow') await wait(1500);
      return { translations: out };
    },
  );

  /** The app: POST /api/chats/:jid/translate-draft {text, target}: one translation, no back-translation. */
  app.post<{ Params: { jid: string } }>(
    '/api/mock/live-translate/chats/:jid/preview',
    { preHandler: requireUser(ctx) },
    async (req) => {
      const body = parse(
        z.object({ text: z.string().min(1).max(4000), from: Lang, to: Lang }),
        req.body ?? {},
      );
      ready(ctx);
      if (state.scenario === 'slow') await wait(1800);
      if (state.scenario === 'error') throw new HttpError(503, 'ai_failed', 'Could not translate');
      spend(userOf(req).id);
      const text = translate(body.text, body.to, state.scenario);
      const changed = changedItem(body.text, text);
      if (changed) return { status: 'refused', ...changed };
      return {
        status: 'ok',
        text,
        from: body.from,
        to: body.to,
        protected: protectedItems(body.text),
        draftId: `draft-${Math.random().toString(36).slice(2, 10)}`,
      };
    },
  );

  /** The app: the optional `translation` block of POST /api/chats/:jid/messages, stored with the message. */
  app.post<{ Params: { jid: string } }>(
    '/api/mock/live-translate/chats/:jid/sent',
    { preHandler: requireUser(ctx) },
    async (req) => {
      const body = parse(
        z.object({
          text: z.string(),
          original: z.string(),
          from: Lang,
          to: Lang,
          edited: z.boolean().default(false),
          kind: z.enum(['translated', 'original']).default('translated'),
        }),
        req.body ?? {},
      );
      state.typed.set(typedKey(req.params.jid, body.text), {
        typed: body.original,
        typedLanguage: body.from,
        sentLanguage: body.to,
        edited: body.edited,
        original: body.kind === 'original',
      });
      return { ok: true };
    },
  );
}

type Call = (method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown) => Promise<any>;

/** Demo data: Tan Wei Jie writes Chinese (long, mixed), Emily Carter English, a reseller group mixes; Aisyah writes Malay. */
export async function seedLiveTranslate(
  ctx: AppContext,
  call: Call,
  aisyahId: number,
): Promise<void> {
  state.myLanguage.set(aisyahId, 'ms');
  const tan = '60127020388@s.whatsapp.net';
  const emily = '6591234567@s.whatsapp.net';
  const ms = TABLE[1]!.t.ms!;
  const zh = lookup(ms, 'zh')!;
  await call('POST', `/chats/${encodeURIComponent(tan)}/messages`, {
    text: zh,
    clientId: `lt-${Math.random().toString(36).slice(2, 12)}`,
  });
  state.typed.set(typedKey(tan, zh), {
    typed: ms,
    typedLanguage: 'ms',
    sentLanguage: 'zh',
    edited: false,
    original: false,
  });
  for (const text of [
    TABLE[2]!.t.zh!,
    TABLE[3]!.t.zh!,
    // Mostly Malay (≥ 70 % in My language): shown as is, no label.
    'Ok boleh, esok saya datang ambil. 谢谢!',
  ])
    await call('POST', '/dev/fake-incoming', { chatJid: tan, senderName: 'Tan Wei Jie', text });
  await call('POST', '/dev/fake-incoming', {
    chatJid: emily,
    senderName: 'Emily Carter',
    text: TABLE[6]!.t.en,
  });
  await call('PUT', `/chats/${encodeURIComponent(emily)}/profile`, {
    name: 'Emily Carter',
    company: 'Lumen Events Pte Ltd',
    tags: [],
  });
  // A reseller group: one member writes Chinese, one Malay (each translated from their own language).
  const fake = ctx.wa as unknown as {
    simulateIncoming(m: { chatJid: string; senderJid: string; senderName: string; body: string }): {
      id: string;
    };
  };
  for (const [phone, name, body] of [
    ['60164441234', 'Lim Ah Kow', TABLE[9]!.t.zh!],
    ['60175556789', 'Rosli Hamid', 'Ok boleh, saya pun nak 30 bungkus. Hantar sekali ya.'],
  ] as const) {
    fake.simulateIncoming({
      chatJid: '120363025550003@g.us',
      senderJid: `${phone}@s.whatsapp.net`,
      senderName: name,
      body,
    });
    await wait(300);
  }
  // Aisyah already uses Live translate in Tan Wei Jie's chat.
  state.switches.add(switchKey(aisyahId, tan));
}

/** Mock only: a new message from Tan Wei Jie, as if it just arrived. */
export const NEXT_CUSTOMER_MESSAGE = TABLE[8]!.t.zh!;

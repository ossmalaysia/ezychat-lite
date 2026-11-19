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
const SCENARIOS = ['normal', 'slow', 'error', 'limit', 'no_connection', 'number_changed'] as const;
type Scenario = (typeof SCENARIOS)[number];

interface Entry {
  /** Text per language. */
  t: Partial<Record<Lang, string>>;
}

/**
 * The demo phrase table: every seeded customer message and the Malay replies the walkthrough types.
 * The real feature asks the "Model for suggestions" for {translation, backTranslation}.
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
  /\b(saya|kami|boleh|tak|ada|nak|terima kasih|hantar|berapa|untuk|dengan|sila|esok|bila)\b/i;
/** Script and word based guess; the app asks the model only when this is unsure (mixed text). */
export function detect(text: string): Lang | null {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  if (cjk >= 2) return 'zh';
  if (/[஀-௿]/.test(text)) return 'ta';
  if (/[฀-๿]/.test(text)) return 'th';
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return null;
  return MALAY.test(text) ? 'ms' : 'en';
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
function lookup(text: string, to: Lang): string | null {
  const n = norm(text);
  for (const e of TABLE) if (Object.values(e.t).some((v) => norm(v!) === n)) return e.t[to] ?? null;
  return null;
}

/**
 * Things a translation must keep exactly (prices, numbers, links, emails, phones, @mentions, codes):
 * the same guard idea as Fix English grammar and the reply-suggestion fact check.
 */
export function protectedItems(text: string): string[] {
  const out = new Set<string>();
  const res = [
    /https?:\/\/\S+/g,
    /[\w.+-]+@[\w-]+\.[\w.]+/g,
    /@\S+/g,
    /RM\s?\d[\d,]*(?:\.\d+)?/gi,
    /\b0\d{1,2}-?\d{3,4}\s?\d{3,4}\b/g,
    /#\w+/g,
    /\b[A-Z]{2,}-?\d+\b/g,
    /\d[\d,]*(?:\.\d+)?/g,
  ];
  let rest = text;
  for (const re of res)
    rest = rest.replace(re, (m) => {
      out.add(m.replace(/\s/g, ''));
      return ' ';
    });
  return [...out];
}

/** Which protected items of `from` the translation lost or changed (spaces ignored). */
export function lostItems(from: string, translated: string): string[] {
  const flat = translated.replace(/\s/g, '');
  return protectedItems(from).filter((item) => !flat.includes(item));
}

function translate(text: string, to: Lang, scenario: Scenario): string {
  const hit = lookup(text, to);
  let out = hit ?? `(${NAMES[to]} · demo) ${text}`;
  // Mock only: a model that changed a price, to show the guard refusing it.
  if (scenario === 'number_changed') out = out.replace(/\d/, (d) => String((Number(d) + 3) % 10));
  return out;
}

interface ChatPref {
  on: boolean;
  /** null = detected from the customer's messages. */
  customerLanguage: Lang | null;
}

interface SentOriginal {
  original: string;
  from: Lang;
  to: Lang;
  byUserId: number;
  /** The staff changed the translation before sending. */
  edited: boolean;
}

const state = {
  enabled: true,
  model: 'fast' as 'fast' | 'main',
  dailyLimit: 500,
  scenario: 'normal' as Scenario,
  myLanguage: new Map<number, Lang>(),
  chats: new Map<string, ChatPref>(),
  sent: new Map<string, SentOriginal>(),
  used: new Map<number, number>(),
  /** Message id + language → translation (the app: a table, so re-opening a chat costs nothing). */
  cache: new Map<string, string>(),
};

const prefKey = (userId: number, jid: string) => `${userId}|${jid}`;
const sentKey = (jid: string, text: string) => `${jid}|${norm(text)}`;
const userOf = (req: FastifyRequest) => req.user!;

/** Default "My language": from the app language (en, ms, zh-CN). */
function myLanguage(userId: number, locale?: string): Lang {
  return (
    state.myLanguage.get(userId) ??
    (locale === 'ms' ? 'ms' : locale?.startsWith('zh') ? 'zh' : 'en')
  );
}

/** The customer's language: detected from their last messages (most frequent wins). */
function detectedFor(ctx: AppContext, jid: string): Lang | null {
  const rows = ctx.db
    .prepare(
      'SELECT body FROM messages WHERE chat_jid = ? AND from_me = 0 AND body IS NOT NULL ORDER BY timestamp DESC LIMIT 10',
    )
    .all(jid) as Array<{ body: string }>;
  const counts = new Map<Lang, number>();
  for (const r of rows) {
    const l = detect(r.body);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function connected(ctx: AppContext): boolean {
  return (
    state.scenario !== 'no_connection' && ctx.services.ai?.status().connection.state === 'connected'
  );
}

/** Each translated message or preview counts one; cached ones are free. */
function spend(userId: number) {
  if (state.scenario === 'limit')
    throw new HttpError(429, 'translate_limit', 'Daily translation limit reached');
  const used = state.used.get(userId) ?? 0;
  if (state.dailyLimit > 0 && used >= state.dailyLimit)
    throw new HttpError(429, 'translate_limit', 'Daily translation limit reached');
  state.used.set(userId, used + 1);
}

function ready(ctx: AppContext) {
  if (!state.enabled) throw new HttpError(409, 'translate_off', 'Live translate is off');
  if (!connected(ctx))
    throw new HttpError(503, 'ai_unavailable', 'The AI connection needs attention');
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerLiveTranslate(app: FastifyInstance, ctx: AppContext): void {
  const status = (req: FastifyRequest) => {
    const user = userOf(req);
    const locale = (req.query as { locale?: string } | undefined)?.locale;
    const usedToday = [...state.used.values()].reduce((a, b) => a + b, 0);
    return {
      enabled: state.enabled,
      model: state.model,
      dailyLimit: state.dailyLimit,
      connected: connected(ctx),
      scenario: state.scenario,
      myLanguage: myLanguage(user.id, locale),
      myLanguageSet: state.myLanguage.has(user.id),
      usedByMe: state.used.get(user.id) ?? 0,
      usedToday,
      peopleToday: state.used.size,
    };
  };
  app.get('/api/mock/live-translate', { preHandler: requireUser(ctx) }, async (req) => status(req));

  app.put('/api/mock/live-translate/settings', { preHandler: requireAdmin(ctx) }, async (req) => {
    const body = parse(
      z.object({
        enabled: z.boolean().optional(),
        model: z.enum(['fast', 'main']).optional(),
        dailyLimit: z.number().int().min(0).max(10_000).optional(),
      }),
      req.body ?? {},
    );
    const before = { enabled: state.enabled, model: state.model, dailyLimit: state.dailyLimit };
    Object.assign(
      state,
      Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    );
    audit(ctx.db, {
      userId: userOf(req).id,
      action: 'settings.live_translate',
      ip: req.ip,
      meta: {
        before,
        after: { enabled: state.enabled, model: state.model, dailyLimit: state.dailyLimit },
      },
    });
    return status(req);
  });

  app.put('/api/mock/live-translate/me', { preHandler: requireUser(ctx) }, async (req) => {
    const { myLanguage: lang } = parse(z.object({ myLanguage: Lang }), req.body ?? {});
    state.myLanguage.set(userOf(req).id, lang);
    return status(req);
  });

  app.put('/api/mock/live-translate/scenario', { preHandler: requireUser(ctx) }, async (req) => {
    state.scenario = parse(z.object({ scenario: z.enum(SCENARIOS) }), req.body ?? {}).scenario;
    if (state.scenario === 'normal') state.used.clear();
    state.cache.clear();
    return status(req);
  });

  const chatState = (req: FastifyRequest, jid: string) => {
    const pref = state.chats.get(prefKey(userOf(req).id, jid)) ?? {
      on: false,
      customerLanguage: null,
    };
    return { ...pref, detected: detectedFor(ctx, jid) };
  };
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
        z.object({ on: z.boolean().optional(), customerLanguage: Lang.nullable().optional() }),
        req.body ?? {},
      );
      const key = prefKey(userOf(req).id, req.params.jid);
      const prev = state.chats.get(key) ?? { on: false, customerLanguage: null };
      state.chats.set(key, {
        on: body.on ?? prev.on,
        customerLanguage:
          body.customerLanguage === undefined ? prev.customerLanguage : body.customerLanguage,
      });
      return chatState(req, req.params.jid);
    },
  );

  /**
   * Translations for the bubbles the viewer sees. Inbound (and outbound without a stored original, e.g. the
   * AI agent's or the phone's replies) are translated into the viewer's language; a team message sent through
   * Live translate answers with what its writer typed.
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
        const sent = m.fromMe ? state.sent.get(sentKey(req.params.jid, m.body)) : undefined;
        if (sent) {
          out[m.id] = {
            kind: 'written',
            original: sent.original,
            from: sent.from,
            to: sent.to,
            edited: sent.edited,
            by: sent.byUserId === user.id ? null : sent.byUserId,
          };
          continue;
        }
        if (!body.translate) continue;
        const from = detect(m.body);
        if (!from || from === body.to) continue;
        const key = `${m.id}|${body.to}`;
        const cached = state.cache.get(key);
        if (cached) {
          out[m.id] = { kind: 'translated', text: cached, from };
          continue;
        }
        if (!state.enabled) continue;
        if (!connected(ctx)) {
          out[m.id] = { kind: 'failed', code: 'ai_unavailable', from };
          continue;
        }
        if (state.scenario === 'error') {
          out[m.id] = { kind: 'failed', code: 'error', from };
          continue;
        }
        try {
          spend(user.id);
        } catch {
          out[m.id] = { kind: 'failed', code: 'translate_limit', from };
          continue;
        }
        const text = translate(m.body, body.to, 'normal');
        state.cache.set(key, text);
        out[m.id] = { kind: 'translated', text, from };
      }
      if (state.scenario === 'slow') await wait(1500);
      return { translations: out };
    },
  );

  /** The send preview: the typed text in the customer's language, and what it says back in mine. */
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
      if (state.scenario === 'error')
        throw new HttpError(503, 'ai_unavailable', 'The AI provider did not answer');
      spend(userOf(req).id);
      const text = translate(body.text, body.to, state.scenario);
      const lost = lostItems(body.text, text);
      if (lost.length) return { status: 'refused', reason: 'changed', items: lost };
      return {
        status: 'ok',
        text,
        back: lookup(text, body.from) ?? body.text,
        from: body.from,
        to: body.to,
      };
    },
  );

  /** After a send: keep what the writer typed beside the message (the app: on the message row). */
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
        }),
        req.body ?? {},
      );
      state.sent.set(sentKey(req.params.jid, body.text), {
        original: body.original,
        from: body.from,
        to: body.to,
        byUserId: userOf(req).id,
        edited: body.edited,
      });
      return { ok: true };
    },
  );
}

type Call = (method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown) => Promise<any>;

/** Demo data: Tan Wei Jie writes Chinese (long and mixed messages), Emily Carter English; Aisyah writes Malay. */
export async function seedLiveTranslate(
  ctx: AppContext,
  call: Call,
  aisyahId: number,
): Promise<void> {
  state.myLanguage.set(aisyahId, 'ms');
  const tan = '60127020388@s.whatsapp.net';
  const emily = '6591234567@s.whatsapp.net';
  const reply = async (jid: string, ms: string, to: Lang) => {
    const text = lookup(ms, to)!;
    await call('POST', `/chats/${encodeURIComponent(jid)}/messages`, {
      text,
      clientId: `lt-${Math.random().toString(36).slice(2, 12)}`,
    });
    state.sent.set(sentKey(jid, text), {
      original: ms,
      from: 'ms',
      to,
      byUserId: aisyahId,
      edited: false,
    });
  };
  await reply(
    tan,
    'Boleh, kami hantar ke Gurney Drive. Penghantaran percuma untuk pesanan melebihi RM40.',
    'zh',
  );
  await call('POST', '/dev/fake-incoming', {
    chatJid: tan,
    senderName: 'Tan Wei Jie',
    text: TABLE[2]!.t.zh,
  });
  await call('POST', '/dev/fake-incoming', {
    chatJid: tan,
    senderName: 'Tan Wei Jie',
    text: TABLE[3]!.t.zh,
  });
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
  state.chats.set(prefKey(aisyahId, tan), { on: true, customerLanguage: null });
}

/** Mock only: a new message from Tan Wei Jie, as if it just arrived. */
export const NEXT_CUSTOMER_MESSAGE = TABLE[8]!.t.zh!;

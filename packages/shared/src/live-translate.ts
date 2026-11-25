import { z } from 'zod';

/**
 * Live translate (design: docs/features/live-translate/design.md, lasting rules in
 * docs/live-translate.md). A teammate reads a chat in "My language" and types in it; replies go out
 * in the customer's language after a preview. Translations use the install's AI connection ("Model
 * for suggestions"); the protected items below are checked by the server on every translation.
 */

/** The languages a person or a chat can have, each shown in its own name. */
export const TRANSLATE_LANGUAGES = [
  'ms',
  'en',
  'zh',
  'id',
  'ta',
  'th',
  'vi',
  'ar',
  'ja',
  'ko',
] as const;
export const TranslateLanguage = z.enum(TRANSLATE_LANGUAGES);
export type TranslateLanguage = z.infer<typeof TranslateLanguage>;

/** Each language in its own name (never translated). */
export const TRANSLATE_LANGUAGE_NAMES: Record<TranslateLanguage, string> = {
  ms: 'Bahasa Melayu',
  en: 'English',
  zh: '中文',
  id: 'Bahasa Indonesia',
  ta: 'தமிழ்',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  ar: 'العربية',
  ja: '日本語',
  ko: '한국어',
};

export const LIVE_TRANSLATE_DEFAULT_DAILY_LIMIT = 200;
/** Most messages one `POST /chats/:jid/translations` asks for (the ones on screen). */
export const LIVE_TRANSLATE_MAX_BATCH = 50;
/** Incoming text is translated only when less than this share of it is already in My language. */
export const LIVE_TRANSLATE_SAME_LANGUAGE_SHARE = 0.7;
export const LIVE_TRANSLATE_TEXT_CHARACTERS = 4096;

/** The admin settings (setting `live_translate`): on for everyone by default, 200 a person a day. */
export const LiveTranslateSettings = z.object({
  enabled: z.boolean().default(true),
  /** Translations per person per day; 0 = no limit. */
  dailyLimit: z.number().int().min(0).max(10_000).default(LIVE_TRANSLATE_DEFAULT_DAILY_LIMIT),
});
export type LiveTranslateSettings = z.infer<typeof LiveTranslateSettings>;

/** `PUT /api/live-translate/settings` (admins). */
export const LiveTranslateSettingsBody = z.strictObject({
  enabled: z.boolean().optional(),
  dailyLimit: z.number().int().min(0).max(10_000).optional(),
});
export type LiveTranslateSettingsBody = z.infer<typeof LiveTranslateSettingsBody>;

/** `GET /api/live-translate` (any signed-in user). */
export const LiveTranslateStatus = LiveTranslateSettings.extend({
  /** The AI connection works now ("Model for suggestions"). */
  connected: z.boolean(),
  /** My translations today (business time zone). */
  usedToday: z.number().int().nonnegative(),
  /** Admins only: people who translated today, and all translations today. */
  peopleToday: z.number().int().nonnegative().optional(),
  translationsToday: z.number().int().nonnegative().optional(),
});
export type LiveTranslateStatus = z.infer<typeof LiveTranslateStatus>;

/** `GET/PUT /api/chats/:jid/live-translate`: my switch plus the chat's shared languages. */
export const ChatTranslateState = z.object({
  /** My switch in this chat. */
  on: z.boolean(),
  /** Chosen by a teammate (shared); wins over detection. */
  customerLanguage: TranslateLanguage.nullable(),
  /** Detected from the customer's last messages. */
  detected: TranslateLanguage.nullable(),
  /** A second language the customer also writes ("中文 + English"). */
  mixed: TranslateLanguage.nullable(),
  /** Groups: the outgoing language chosen by a teammate (shared). */
  outgoingLanguage: TranslateLanguage.nullable(),
  /** Groups: the most used language of the last 20 messages. */
  outgoingDetected: TranslateLanguage.nullable(),
});
export type ChatTranslateState = z.infer<typeof ChatTranslateState>;

export const ChatTranslateBody = z.strictObject({
  on: z.boolean().optional(),
  customerLanguage: TranslateLanguage.nullable().optional(),
  outgoingLanguage: TranslateLanguage.nullable().optional(),
});
export type ChatTranslateBody = z.infer<typeof ChatTranslateBody>;

/** `POST /api/chats/:jid/translations`: the messages on screen, into My language. */
export const TranslationsBody = z.strictObject({
  messageIds: z.array(z.string().min(1).max(256)).min(1).max(LIVE_TRANSLATE_MAX_BATCH),
  target: TranslateLanguage,
});
export type TranslationsBody = z.infer<typeof TranslationsBody>;

export const MessageTranslation = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), text: z.string(), from: TranslateLanguage }),
  /** Already (70 % or more) in the target language, or nothing to translate. */
  z.object({ status: z.literal('same_language') }),
  /** The translation changed a protected item: never shown. */
  z.object({ status: z.literal('unsafe'), from: TranslateLanguage }),
  z.object({ status: z.literal('limit') }),
  z.object({ status: z.literal('ai_unavailable') }),
  z.object({ status: z.literal('failed') }),
]);
export type MessageTranslation = z.infer<typeof MessageTranslation>;

export const TranslationsResponse = z.object({
  translations: z.record(z.string(), MessageTranslation),
});
export type TranslationsResponse = z.infer<typeof TranslationsResponse>;

/** `POST /api/chats/:jid/translate-draft`: what I typed, into the customer's language. */
export const TranslateDraftBody = z.strictObject({
  text: z.string().min(1).max(LIVE_TRANSLATE_TEXT_CHARACTERS),
  target: TranslateLanguage,
});
export type TranslateDraftBody = z.infer<typeof TranslateDraftBody>;

export const TranslateDraft = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    translation: z.string(),
    from: TranslateLanguage,
    /** The protected items kept unchanged (the "Kept unchanged" chips). */
    protected: z.array(z.string()),
    /** Send it back with the message (`SendTranslation.draftId`). */
    draftId: z.string(),
  }),
  /** A protected item changed: "RM1,260.00 became RM4,260.00. Nothing was sent." (`became` '' = missing). */
  z.object({ status: z.literal('refused'), item: z.string(), became: z.string() }),
]);
export type TranslateDraft = z.infer<typeof TranslateDraft>;

/** Optional block on `POST /chats/:jid/messages`: the message text is the (maybe edited) translation. */
export const SendTranslation = z.strictObject({
  draftId: z.string().min(1).max(64),
  typedText: z.string().min(1).max(LIVE_TRANSLATE_TEXT_CHARACTERS),
  typedLanguage: TranslateLanguage,
  edited: z.boolean().default(false),
});
export type SendTranslation = z.infer<typeof SendTranslation>;

/** What the writer typed before it was translated (team replies only). */
export const TypedRecordValue = z.object({
  typedText: z.string(),
  typedLanguage: TranslateLanguage,
  sentLanguage: TranslateLanguage,
  edited: z.boolean(),
});
/**
 * On `Message` as `typed` (absent/null = not translated) beside `sentOriginal` (absent = false). Both
 * are optional on `Message` so older fixtures and servers keep parsing.
 */
export const TypedRecord = TypedRecordValue.nullable().default(null);
export type TypedRecord = z.infer<typeof TypedRecord>;

/** The default My language for an app language (en → en, ms → ms, zh-CN → zh). */
export function translateLanguageForLocale(locale: string | null | undefined): TranslateLanguage {
  if (!locale) return 'en';
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return (TRANSLATE_LANGUAGES as readonly string[]).includes(base!)
    ? (base as TranslateLanguage)
    : 'en';
}

// ---------------------------------------------------------------------------------------------
// Protected items: numbers, prices, dates and times in digits, links, emails, phones, @mentions,
// order/tracking codes and emoji. They must come through a translation unchanged (spaces ignored).
// ---------------------------------------------------------------------------------------------

const CURRENCY = String.raw`(?:RM|MYR|USD|SGD|RMB|IDR|THB|S\$|US\$|Rp|\$|€|£|¥|₹)`;
const NUMBER = String.raw`\d+(?:[.,]\d+)*`;
const ITEM_PATTERN = new RegExp(
  [
    String.raw`(?<url>(?:https?:\/\/|www\.)[^\s<>"']+)`,
    // At most 64 before the @ (the longest a mailbox name may be): an unbounded run made the scan try an email at
    // every letter of a long word, quadratic on a long message.
    String.raw`(?<email>[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,})`,
    String.raw`(?<mention>@[\p{L}\p{N}_.]+)`,
    String.raw`(?<date>(?<![\d])\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}(?![\d]))`,
    String.raw`(?<time>(?<![\d])\d{1,2}:\d{2}(?::\d{2})?(?![\d]))`,
    String.raw`(?<price>${CURRENCY}\s?${NUMBER})`,
    String.raw`(?<phone>(?<![\w+])\+?\d(?:[ -]?\d){7,14}(?![\d]))`,
    String.raw`(?<code>(?<![A-Za-z0-9])(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?![A-Za-z0-9]))`,
    String.raw`(?<number>${NUMBER}%?)`,
    String.raw`(?<emoji>\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)`,
  ].join('|'),
  'gu',
);
/** A number with a lowercase unit (10am, 5kg, 2pcs, 3rd) is not a code: only its number is kept. */
const UNIT = /^(\d+(?:[.,]\d+)*)[a-z]{1,4}$/;

const TRAILING = new Set('.,!?;:)]}\'"');

/** Drops trailing punctuation by walking back from the end: a `[…]+$` regex retried at every dot of a long link. */
function trimTrailing(item: string): string {
  let end = item.length;
  while (end > 0 && TRAILING.has(item[end - 1]!)) end--;
  return item.slice(0, end);
}

/** The protected items of a text, in order, without repeats. */
export function protectedItems(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (item: string): void => {
    const key = compact(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  for (const match of text.matchAll(ITEM_PATTERN)) {
    const g = match.groups ?? {};
    if (g.url) add(trimTrailing(g.url));
    else if (g.email) add(g.email);
    else if (g.mention) add(trimTrailing(g.mention));
    else if (g.code) {
      const unit = UNIT.exec(g.code);
      add(unit ? unit[1]! : g.code);
    } else add(match[0]);
  }
  return out;
}

function compact(text: string): string {
  return text.replace(/\s+/gu, '');
}

/** `item` occurs in `haystack` (both without spaces), not as part of a longer number. */
function containsItem(haystack: string, item: string): boolean {
  const needle = compact(item);
  if (!needle) return true;
  const startsDigit = /^\d/.test(needle);
  const endsDigit = /\d$/.test(needle);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = haystack.slice(0, at);
    const after = haystack.slice(at + needle.length);
    const badBefore = startsDigit && /(?:\d|\d[.,])$/.test(before);
    const badAfter = endsDigit && /^(?:\d|[.,]\d)/.test(after);
    if (!badBefore && !badAfter) return true;
    from = at + 1;
  }
}

/**
 * The first protected item of `source` that does not appear unchanged in `translation`, and what it
 * became (a new item of the translation with digits like it, else ''). null = all kept.
 */
export function changedItem(
  source: string,
  translation: string,
): { item: string; became: string } | null {
  const hay = compact(translation);
  const items = protectedItems(source);
  const missing = items.find((item) => !containsItem(hay, item));
  if (missing === undefined) return null;
  const known = new Set(items.map(compact));
  const hasDigit = /\d/.test(missing);
  const candidates = protectedItems(translation).filter(
    (item) => !known.has(compact(item)) && /\d/.test(item) === hasDigit,
  );
  return { item: missing, became: candidates[0] ?? '' };
}

// ---------------------------------------------------------------------------------------------
// Language share: how much of a text is already in a language (script and common words), 0..1.
// ---------------------------------------------------------------------------------------------

const SCRIPTS: Partial<Record<TranslateLanguage, RegExp>> = {
  ta: /\p{Script=Tamil}/u,
  th: /\p{Script=Thai}/u,
  ar: /\p{Script=Arabic}/u,
  ko: /\p{Script=Hangul}/u,
};
const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN = /\p{Script=Latin}/u;
const VI_MARKS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/iu;

const WORDS: Record<'en' | 'ms' | 'vi', ReadonlySet<string>> = {
  en: new Set(
    `the a an is are was were be been am i you he she it we they me my your our their this that these those
    what which who when where why how and or but if so to of in on at for with from by about as not no yes
    can could will would should do does did have has had please thank thanks hello hi want need price how
    much order send sent delivery today tomorrow there here get got any some all more just also very okay
    ok good morning afternoon evening sorry let know help like one two three item items still yet`
      .split(/\s+/)
      .filter(Boolean),
  ),
  ms: new Set(
    `saya awak kamu anda dia kami kita mereka ini itu yang dan atau tetapi tapi kalau jika untuk dengan dari
    ke di pada boleh tak tidak bukan ada apa bila mana kenapa bagaimana macam mana berapa harga mahu nak
    hendak perlu sudah dah belum lagi juga sahaja saja terima kasih tolong encik puan cik selamat pagi petang
    malam hari esok semalam hantar barang pesanan bayar duit sila minta maaf ya baik okey sangat banyak
    sikit semua satu dua tiga kerana sebab jadi akan sedang telah oleh tentang kepada bagi masih mau aku
    gimana bisa sudah dong nya kok sih enggak nggak terima`
      .split(/\s+/)
      .filter(Boolean),
  ),
  vi: new Set(
    `tôi bạn anh chị em không có là của và và với cho này đó được một hai ba gì sao thế nào bao nhiêu giá
    xin chào cảm ơn vâng dạ rồi đã sẽ đang muốn cần gửi hàng đơn ngày mai hôm nay`
      .split(/\s+/)
      .filter(Boolean),
  ),
};

function latinGroup(lang: TranslateLanguage): 'en' | 'ms' | 'vi' | null {
  if (lang === 'en') return 'en';
  if (lang === 'ms' || lang === 'id') return 'ms';
  if (lang === 'vi') return 'vi';
  return null;
}

/** The text without its protected items (links, codes and numbers say nothing about a language). */
function withoutItems(text: string): string {
  let out = text;
  for (const item of protectedItems(text)) out = out.split(item).join(' ');
  return out;
}

interface LetterCounts {
  total: number;
  han: number;
  kana: number;
  latin: number;
  script: Partial<Record<TranslateLanguage, number>>;
  /** Known Latin words: the groups (en, ms incl. id, vi) each one belongs to. */
  words: Array<ReadonlySet<'en' | 'ms' | 'vi'>>;
}

function countLetters(text: string): LetterCounts {
  const counts: LetterCounts = {
    total: 0,
    han: 0,
    kana: 0,
    latin: 0,
    script: {},
    words: [],
  };
  const clean = withoutItems(text);
  for (const ch of clean) {
    if (!/\p{L}/u.test(ch)) continue;
    counts.total += 1;
    if (HAN.test(ch)) counts.han += 1;
    else if (KANA.test(ch)) counts.kana += 1;
    else if (LATIN.test(ch)) counts.latin += 1;
    else {
      for (const [lang, re] of Object.entries(SCRIPTS) as [TranslateLanguage, RegExp][]) {
        if (re.test(ch)) counts.script[lang] = (counts.script[lang] ?? 0) + 1;
      }
    }
  }
  for (const raw of clean.toLowerCase().match(/[\p{Script=Latin}']+/gu) ?? []) {
    const word = raw.replace(/'/g, '');
    const groups = new Set<'en' | 'ms' | 'vi'>();
    if (VI_MARKS.test(word) || WORDS.vi.has(word)) groups.add('vi');
    if (WORDS.en.has(word)) groups.add('en');
    if (WORDS.ms.has(word)) groups.add('ms');
    if (groups.size > 0) counts.words.push(groups);
  }
  return counts;
}

/** The share of `text` (letters) that is in `lang`, 0..1. Text with no letters counts as 1. */
export function shareInLanguage(text: string, lang: TranslateLanguage): number {
  const c = countLetters(text);
  if (c.total === 0) return 1;
  let inLang = 0;
  if (lang === 'zh') inLang = c.kana > 0 ? 0 : c.han;
  else if (lang === 'ja') inLang = c.kana > 0 ? c.kana + c.han : 0;
  else if (SCRIPTS[lang]) inLang = c.script[lang] ?? 0;
  else if (c.latin > 0) {
    const group = latinGroup(lang);
    // Latin text with no known word (names, "ok", short codes) counts as mine: nothing to translate.
    const mine = c.words.filter((g) => group !== null && g.has(group)).length;
    const latinShare = c.words.length === 0 ? (group ? 1 : 0) : mine / c.words.length;
    inLang = c.latin * latinShare;
  }
  return Math.min(1, inLang / c.total);
}

/**
 * The language a text is mostly in, from its script (zh, ta, th, ar, ja, ko) or, for Latin text,
 * from common words (en, ms, vi; Indonesian reads as Malay). null = not sure.
 */
export function guessLanguage(text: string): TranslateLanguage | null {
  const c = countLetters(text);
  if (c.total === 0) return null;
  const scores: [TranslateLanguage, number][] = [
    ['zh', c.kana > 0 ? 0 : c.han],
    ['ja', c.kana > 0 ? c.kana + c.han : 0],
    ...(Object.entries(c.script) as [TranslateLanguage, number][]),
  ];
  if (c.latin > 0 && c.words.length > 0) {
    const count = (g: 'en' | 'ms' | 'vi'): number => c.words.filter((w) => w.has(g)).length;
    const best = (['en', 'ms', 'vi'] as const).reduce((a, b) => (count(b) > count(a) ? b : a));
    if (count(best) * 2 > c.words.length) scores.push([best, c.latin]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const [lang, score] = scores[0] ?? [null, 0];
  return lang && score / c.total >= 0.5 ? lang : null;
}

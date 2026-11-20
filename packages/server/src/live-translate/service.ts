import { randomUUID } from 'node:crypto';
import {
  LIVE_TRANSLATE_SAME_LANGUAGE_SHARE,
  LiveTranslateSettings,
  changedItem,
  guessLanguage,
  protectedItems,
  shareInLanguage,
  translateLanguageForLocale,
  type ChatTranslateBody,
  type ChatTranslateState,
  type LiveTranslateSettingsBody,
  type LiveTranslateStatus,
  type Message,
  type MessageTranslation,
  type SendTextBody,
  type TranslateDraft,
  type TranslateLanguage,
  type User,
} from '@ezychat/shared';
import { AI_TIMEZONE_SETTING, resolveAiTimeZone } from '../ai/prompt.js';
import { TranslateFailedError } from '../ai/service.js';
import { localDate } from '../chats/stats.js';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../http/errors.js';
import { LiveTranslateRepo, type SourceMessage, type UserTranslatePrefs } from './repo.js';

/**
 * Live translate (design docs/features/live-translate/design.md, rules docs/live-translate.md).
 * Holds the admin setting, the per-person daily limit, the translation cache, the 70 % rule, the
 * chat's detected language, the drafts behind "Customer will get" and the check of a translated
 * send. Logs `live_translate` lines with counts, language codes, ms, model and a result code only.
 */

export const LIVE_TRANSLATE_KEY = 'live_translate';
/** A draft (the "Customer will get" card) can be sent for this long. */
export const DRAFT_TTL_MS = 30 * 60_000;
/** Drafts kept per person (oldest dropped first): one person never pushes out another's. */
const DRAFTS_PER_USER = 50;
/** The customer's language comes from their last 10 messages; a group's from the last 20. */
const DETECT_MESSAGES = 10;
const GROUP_DETECT_MESSAGES = 20;
/** A second language counts as "mixed" with at least this many of the messages read. */
const MIXED_MIN = 2;
const USAGE_KEEP_MS = 31 * 24 * 60 * 60_000;

export interface Actor {
  userId: number;
  ip: string | null;
}

/** One "Customer will get" card: a send must carry exactly this typed text. */
interface Draft {
  userId: number;
  chatJid: string;
  typedText: string;
  typedLanguage: TranslateLanguage;
  translation: string;
  target: TranslateLanguage;
  createdAt: number;
}

export interface LiveTranslateService {
  settings(): LiveTranslateSettings;
  setSettings(body: LiveTranslateSettingsBody, actor: Actor): void;
  status(user: User): LiveTranslateStatus;
  /** My language: the chosen one, else from the app language. */
  myLanguage(user: Pick<User, 'id' | 'locale'>): TranslateLanguage;
  prefs(userId: number): UserTranslatePrefs;
  setPrefs(userId: number, patch: Partial<UserTranslatePrefs>, actor: Actor): void;
  chatState(user: User, jid: string): ChatTranslateState;
  setChatState(user: User, jid: string, body: ChatTranslateBody): ChatTranslateState;
  translateMessages(
    user: User,
    jid: string,
    ids: readonly string[],
    target: TranslateLanguage,
    signal: AbortSignal,
  ): Promise<Record<string, MessageTranslation>>;
  translateDraft(
    user: User,
    jid: string,
    text: string,
    target: TranslateLanguage,
    signal: AbortSignal,
  ): Promise<TranslateDraft>;
  /**
   * Checks the Live translate part of a send before anything is stored and returns what stores the
   * typed record with the message (inside its insert), or null when the send has none. 400
   * `translation_expired` / `translation_changed`, 409 `translate_off`.
   */
  prepareSend(user: User, jid: string, body: SendTextBody): ((messageId: string) => void) | null;
  /** Adds `typed` / `sentOriginal` to presented messages. */
  attach(messages: Message[]): Message[];
}

declare module '../context.js' {
  interface Services {
    liveTranslate?: LiveTranslateService;
  }
}

export function initLiveTranslate(ctx: AppContext): void {
  ctx.services.liveTranslate = createLiveTranslateService(ctx);
}

const translateOff = () => new HttpError(409, 'translate_off', 'Live translate is off');

export function createLiveTranslateService(
  ctx: AppContext,
  deps: { now?: () => number } = {},
): LiveTranslateService {
  const now = deps.now ?? Date.now;
  const repo = new LiveTranslateRepo(ctx.db);
  const log = ctx.log.child({ mod: 'live-translate' });
  const drafts = new Map<string, Draft>();

  const settings = (): LiveTranslateSettings => {
    const parsed = LiveTranslateSettings.safeParse(
      ctx.settings.get<unknown>(LIVE_TRANSLATE_KEY, {}),
    );
    return parsed.success ? parsed.data : LiveTranslateSettings.parse({});
  };
  const dayOf = (t: number) =>
    localDate(t, resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null)));
  const today = () => dayOf(now());
  /** Counts translations against today's limit; days older than a month are dropped. */
  const recordUsage = (userId: number, count: number) => {
    repo.addUsage(userId, today(), count);
    repo.pruneUsage(dayOf(now() - USAGE_KEEP_MS));
  };
  const refundUsage = (userId: number, count: number) => repo.addUsage(userId, today(), -count);
  const sourceOf = (stored: string, target: TranslateLanguage): TranslateLanguage =>
    (stored || fallbackSource(target)) as TranslateLanguage;
  const connected = () => ctx.services.ai?.draftConnection() === 'ready' && ctx.access.state().open;
  const myLanguage = (user: Pick<User, 'id' | 'locale'>): TranslateLanguage =>
    repo.prefs(user.id).translateLanguage ?? translateLanguageForLocale(user.locale);
  /** How many more translations the person may make today (Infinity = no limit). */
  const remaining = (userId: number): number => {
    const limit = settings().dailyLimit;
    return limit === 0 ? Infinity : Math.max(0, limit - repo.used(userId, today()));
  };
  const chatType = (jid: string) => ctx.services.chats?.get(jid)?.type ?? 'dm';

  const textOf = (m: SourceMessage): string => {
    if (m.type === 'audio') return m.transcript_status === 'ok' ? (m.transcript ?? '') : '';
    return m.body ?? '';
  };
  const revisionOf = (m: SourceMessage) => m.edited_at ?? 0;

  /** Language of each message: a cached translation's source, else the script / common words. */
  const languagesOf = (rows: SourceMessage[]): TranslateLanguage[] => {
    const cached = repo.sources(rows.map((r) => r.id));
    return rows.flatMap((r) => {
      const lang = (cached.get(r.id) as TranslateLanguage | undefined) ?? guessLanguage(textOf(r));
      return lang ? [lang] : [];
    });
  };
  const ranked = (langs: TranslateLanguage[]): Array<[TranslateLanguage, number]> => {
    const counts = new Map<TranslateLanguage, number>();
    for (const l of langs) counts.set(l, (counts.get(l) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  /** Re-reads the customer's (or a group's) language from the last messages and stores it. */
  const detect = (jid: string) => {
    const group = chatType(jid) === 'group';
    const rows = repo.recentInbound(jid, group ? GROUP_DETECT_MESSAGES : DETECT_MESSAGES);
    const top = ranked(languagesOf(rows));
    const detected = top[0]?.[0] ?? null;
    const second = top[1];
    const mixed = !group && second && second[1] >= MIXED_MIN ? second[0] : null;
    const current = repo.chatLanguage(jid);
    if (current?.detected !== detected || current?.mixed !== mixed)
      repo.setChatLanguage(jid, { detected, mixed }, now());
  };

  const stateOf = (user: User, jid: string): ChatTranslateState => {
    const row = repo.chatLanguage(jid);
    const group = chatType(jid) === 'group';
    const lang = (v: string | null | undefined) => (v ?? null) as TranslateLanguage | null;
    return {
      on: repo.isOn(user.id, jid),
      customerLanguage: group ? null : lang(row?.chosen),
      detected: group ? null : lang(row?.detected),
      mixed: group ? null : lang(row?.mixed),
      outgoingLanguage: group ? lang(row?.outgoing) : null,
      outgoingDetected: group ? lang(row?.detected) : null,
    };
  };

  const logLine = (fields: {
    kind: 'messages' | 'draft';
    items: number;
    cached: number;
    source: string | null;
    target: string;
    started: number;
    model: string | null;
    result: string;
    causeName?: string | null;
    status?: number | null;
  }) => {
    const { started, ...rest } = fields;
    // Never the text, the chat or message ids: counts, language codes, ms, model and result only.
    log.info({ event: 'live_translate', ...rest, ms: now() - started }, 'Live translate');
  };

  const pruneDrafts = () => {
    const cutoff = now() - DRAFT_TTL_MS;
    for (const [id, d] of drafts) if (d.createdAt < cutoff) drafts.delete(id);
  };
  const keepDraft = (draft: Draft): string => {
    pruneDrafts();
    const mine = [...drafts].filter(([, d]) => d.userId === draft.userId);
    for (const [id] of mine.slice(0, Math.max(0, mine.length - DRAFTS_PER_USER + 1)))
      drafts.delete(id);
    const id = randomUUID();
    drafts.set(id, draft);
    return id;
  };
  /** The source language of a message for the answer when nobody could tell (never stored as known). */
  const fallbackSource = (target: TranslateLanguage): TranslateLanguage =>
    target === 'en' ? 'ms' : 'en';

  // A message deleted for everyone (or hidden) keeps no translations.
  ctx.bus.on('message:updated', (m) => {
    if (m.deletedAt != null || m.hidden) repo.dropTranslations(m.id);
  });

  const service: LiveTranslateService = {
    settings,

    setSettings(body, actor) {
      const before = settings();
      const after = LiveTranslateSettings.parse({ ...before, ...body });
      ctx.settings.set(LIVE_TRANSLATE_KEY, after);
      if (before.enabled !== after.enabled || before.dailyLimit !== after.dailyLimit)
        audit(ctx.db, {
          userId: actor.userId,
          action: 'settings.live_translate',
          ip: actor.ip,
          meta: { before, after },
        });
    },

    status(user) {
      const day = today();
      const base: LiveTranslateStatus = {
        ...settings(),
        connected: connected(),
        usedToday: repo.used(user.id, day),
      };
      if (user.role !== 'admin') return base;
      const all = repo.usageOn(day);
      return { ...base, peopleToday: all.people, translationsToday: all.translations };
    },

    myLanguage,
    prefs: (userId) => repo.prefs(userId),

    setPrefs(userId, patch, actor) {
      const before = repo.prefs(userId);
      repo.setPrefs(userId, patch);
      if (
        patch.translateLanguage !== undefined &&
        patch.translateLanguage !== before.translateLanguage
      )
        audit(ctx.db, {
          userId,
          action: 'user.translate_language',
          ip: actor.ip,
          meta: { language: patch.translateLanguage },
        });
    },

    chatState(user, jid) {
      if (!settings().enabled) throw translateOff();
      detect(jid);
      return stateOf(user, jid);
    },

    setChatState(user, jid, body) {
      if (!settings().enabled) throw translateOff();
      const t = now();
      ctx.db.transaction(() => {
        if (body.on !== undefined) repo.setOn(user.id, jid, body.on, t);
        const group = chatType(jid) === 'group';
        if (body.customerLanguage !== undefined && !group)
          repo.setChatLanguage(jid, { chosen: body.customerLanguage }, t);
        if (body.outgoingLanguage !== undefined && group)
          repo.setChatLanguage(jid, { outgoing: body.outgoingLanguage }, t);
      })();
      detect(jid);
      return stateOf(user, jid);
    },

    async translateMessages(user, jid, ids, target, signal) {
      if (!settings().enabled) throw translateOff();
      const started = now();
      const out: Record<string, MessageTranslation> = {};
      const rows = repo
        .messages(jid, [...new Set(ids)])
        .filter((m) => m.deleted_at == null && m.hidden_at == null && m.type !== 'system');
      const typed = repo.typed(rows.map((r) => r.id));
      const todo: SourceMessage[] = [];
      for (const m of rows) {
        const text = textOf(m).trim();
        // A reply typed in the target language shows what was typed: nothing to translate.
        const own = typed.get(m.id);
        if (
          !text ||
          (own && own.sent_original === 0 && own.typed_lang === target) ||
          shareInLanguage(text, target) >= LIVE_TRANSLATE_SAME_LANGUAGE_SHARE
        )
          out[m.id] = { status: 'same_language' };
        else todo.push(m);
      }
      const cache = repo.translations(
        todo.map((m) => ({ id: m.id, revision: revisionOf(m) })),
        target,
      );
      const missing: SourceMessage[] = [];
      for (const m of todo) {
        const hit = cache.get(m.id);
        if (!hit) missing.push(m);
        else if (hit.status === 'ok')
          out[m.id] = { status: 'ok', text: hit.text, from: sourceOf(hit.source, target) };
        else if (hit.status === 'unsafe')
          out[m.id] = { status: 'unsafe', from: sourceOf(hit.source, target) };
        else out[m.id] = { status: 'same_language' };
      }
      const cached = todo.length - missing.length;
      if (!missing.length) {
        if (todo.length)
          logLine({
            kind: 'messages',
            items: 0,
            cached,
            source: null,
            target,
            started,
            model: null,
            result: 'cached',
          });
        return out;
      }
      if (!connected()) {
        for (const m of missing) out[m.id] = { status: 'ai_unavailable' };
        logLine({
          kind: 'messages',
          items: missing.length,
          cached,
          source: null,
          target,
          started,
          model: null,
          result: 'ai_unavailable',
        });
        return out;
      }
      const allowed = remaining(user.id);
      const batch = missing.slice(0, allowed === Infinity ? missing.length : allowed);
      for (const m of missing.slice(batch.length)) out[m.id] = { status: 'limit' };
      // Counted before the call (no await in between), so parallel requests cannot pass the limit;
      // given back when the call fails.
      if (batch.length) recordUsage(user.id, batch.length);
      if (!batch.length) {
        logLine({
          kind: 'messages',
          items: missing.length,
          cached,
          source: null,
          target,
          started,
          model: null,
          result: 'limit',
        });
        return out;
      }
      try {
        const answer = await ctx.services.ai!.translate(
          jid,
          { items: batch.map((m) => ({ id: m.id, text: textOf(m) })), target },
          signal,
        );
        const t = now();
        const byId = new Map(answer.items.map((i) => [i.id, i]));
        const sources = new Set<string>();
        ctx.db.transaction(() => {
          for (const m of batch) {
            const item = byId.get(m.id)!;
            const text = textOf(m);
            // An unknown source is stored as '' and never counts for the chat's language.
            const known = item.detected ?? guessLanguage(text);
            const from = known ?? fallbackSource(target);
            if (known) sources.add(known);
            const same = from === target && item.translation.trim() === text.trim();
            const unsafe = !same && changedItem(text, item.translation) !== null;
            const status = same ? 'same' : unsafe ? 'unsafe' : 'ok';
            repo.putTranslation({
              message_id: m.id,
              revision: revisionOf(m),
              target,
              source: known ?? '',
              text: status === 'ok' ? item.translation : '',
              status,
              model: answer.model,
              created_at: t,
            });
            out[m.id] =
              status === 'ok'
                ? { status: 'ok', text: item.translation, from }
                : status === 'unsafe'
                  ? { status: 'unsafe', from }
                  : { status: 'same_language' };
          }
        })();
        detect(jid);
        logLine({
          kind: 'messages',
          items: batch.length,
          cached,
          source: sources.size === 1 ? [...sources][0]! : sources.size ? 'mixed' : null,
          target,
          started,
          model: answer.model,
          result: 'ok',
        });
      } catch (error) {
        refundUsage(user.id, batch.length);
        if (signal.aborted) throw error;
        for (const m of batch)
          out[m.id] = { status: error instanceof HttpError ? 'ai_unavailable' : 'failed' };
        const failure = error instanceof TranslateFailedError ? error : null;
        logLine({
          kind: 'messages',
          items: batch.length,
          cached,
          source: null,
          target,
          started,
          model: null,
          result: error instanceof HttpError ? 'ai_unavailable' : 'failed',
          causeName: failure?.causeName ?? null,
          status: failure?.status ?? null,
        });
      }
      return out;
    },

    async translateDraft(user, jid, text, target, signal) {
      if (!settings().enabled) throw translateOff();
      const started = now();
      const source = myLanguage(user);
      const fail = (result: string, error: HttpError, cause?: TranslateFailedError | null) => {
        logLine({
          kind: 'draft',
          items: 1,
          cached: 0,
          source,
          target,
          started,
          model: null,
          result,
          causeName: cause?.causeName ?? null,
          status: cause?.status ?? null,
        });
        return error;
      };
      if (!connected())
        throw fail(
          'ai_unavailable',
          new HttpError(503, 'ai_unavailable', 'Live translate needs AI'),
        );
      if (remaining(user.id) <= 0)
        throw fail('limit', new HttpError(429, 'translate_limit', 'Daily limit used'));
      recordUsage(user.id, 1); // before the call: parallel drafts cannot pass the limit
      let answer: Awaited<ReturnType<NonNullable<AppContext['services']['ai']>['translate']>>;
      try {
        answer = await ctx.services.ai!.translate(
          jid,
          { items: [{ id: 'draft', text }], target, source },
          signal,
        );
      } catch (error) {
        refundUsage(user.id, 1);
        if (signal.aborted) throw error;
        if (error instanceof HttpError) throw fail('ai_unavailable', error);
        throw fail(
          'failed',
          new HttpError(503, 'translate_failed', 'Could not translate. Nothing was sent.'),
          error instanceof TranslateFailedError ? error : null,
        );
      }
      const translation = answer.items[0]!.translation;
      const changed = changedItem(text, translation);
      logLine({
        kind: 'draft',
        items: 1,
        cached: 0,
        source,
        target,
        started,
        model: answer.model,
        result: changed ? 'refused' : 'ok',
      });
      if (changed) return { status: 'refused', ...changed };
      const draftId = keepDraft({
        userId: user.id,
        chatJid: jid,
        typedText: text,
        typedLanguage: source,
        translation,
        target,
        createdAt: now(),
      });
      return { status: 'ok', translation, from: source, protected: protectedItems(text), draftId };
    },

    prepareSend(user, jid, body) {
      if (body.translation) {
        if (!settings().enabled) throw translateOff();
        pruneDrafts();
        const draftId = body.translation.draftId;
        const draft = drafts.get(draftId);
        // The draft is the caller's, for this chat, and for exactly this typed text.
        if (
          !draft ||
          draft.userId !== user.id ||
          draft.chatJid !== jid ||
          draft.typedText !== body.translation.typedText
        )
          throw new HttpError(400, 'translation_expired', 'Translate again before sending');
        const changed = changedItem(draft.typedText, body.text);
        if (changed)
          throw new HttpError(
            400,
            'translation_changed',
            changed.became
              ? `${changed.item} became ${changed.became}. Nothing was sent.`
              : `${changed.item} is missing. Nothing was sent.`,
          );
        return (messageId) => {
          // used once: a second send needs a new translation
          drafts.delete(draftId);
          repo.putTyped({
            message_id: messageId,
            user_id: user.id,
            typed_text: draft.typedText,
            typed_lang: draft.typedLanguage,
            sent_lang: draft.target,
            // decided here, not by the client: the sent text differs from the translation
            edited: body.text.trim() === draft.translation.trim() ? 0 : 1,
            sent_original: 0,
            created_at: now(),
          });
        };
      }
      if (body.sentOriginal && settings().enabled) {
        const lang = myLanguage(user);
        return (messageId) =>
          repo.putTyped({
            message_id: messageId,
            user_id: user.id,
            typed_text: body.text,
            typed_lang: lang,
            sent_lang: lang,
            edited: 0,
            sent_original: 1,
            created_at: now(),
          });
      }
      return null;
    },

    attach(messages) {
      const ids = messages.filter((m) => m.fromMe && m.deletedAt == null).map((m) => m.id);
      if (!ids.length) return messages;
      const rows = repo.typed(ids);
      if (!rows.size) return messages;
      return messages.map((m) => {
        const row = m.deletedAt == null ? rows.get(m.id) : undefined;
        if (!row) return m;
        if (row.sent_original === 1) return { ...m, typed: null, sentOriginal: true };
        return {
          ...m,
          typed: {
            typedText: row.typed_text,
            typedLanguage: row.typed_lang as TranslateLanguage,
            sentLanguage: row.sent_lang as TranslateLanguage,
            edited: row.edited === 1,
          },
          sentOriginal: false,
        };
      });
    },
  };
  return service;
}

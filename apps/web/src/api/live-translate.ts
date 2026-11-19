import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  QueryClientContext,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { Locale } from '@ezychat/shared';
import { useAuth } from '../auth/AuthProvider';
import { useLocale } from '@/i18n/locale-store';
import { api, ApiError } from './client';
import { qk } from './queries';
import {
  TRANSLATE_LANGUAGES,
  type ChatTranslateBody,
  type ChatTranslateState,
  type LiveTranslateSettings,
  type LiveTranslateStatus,
  type MeTranslate,
  type MessageTranslation,
  type TranslatableMessage,
  type TranslateDraft,
  type TranslateLanguage,
  type TranslationsResponse,
} from './live-translate-types';

export { TRANSLATE_LANGUAGES };
export type { TranslateLanguage };

const enc = encodeURIComponent;

/** Each language in its own name (the pickers show these). */
export const NATIVE: Record<TranslateLanguage, string> = {
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

/** My language until I pick one: the app language (design rule 1). */
const FROM_APP_LOCALE: Record<Locale, TranslateLanguage> = { en: 'en', ms: 'ms', 'zh-CN': 'zh' };

export const statusKey = ['live-translate', 'status'] as const;
export const chatStateKey = (jid: string) => ['live-translate', 'chat', jid] as const;
export const translationsKey = (jid: string, my: TranslateLanguage) =>
  ['live-translate', 'translations', jid, my] as const;

/** The admin switch, the limit, whether AI is connected and my use today. Refetched on focus: it is a counter. */
export function useLiveTranslateStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => api<LiveTranslateStatus>('/live-translate'),
    staleTime: 30_000,
  });
}

/** Admins: the switch and the daily limit (Settings → AI). */
export function useSetLiveTranslateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<LiveTranslateSettings>) =>
      api<LiveTranslateStatus>('/live-translate/settings', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(statusKey, data),
  });
}

/** My language and "Send without preview", read from `/api/me`. */
export function useMyTranslate() {
  const { user } = useAuth();
  const locale = useLocale();
  const me = user as (typeof user & MeTranslate) | null;
  const chosen = me?.translateLanguage ?? null;
  return {
    myLanguage: chosen ?? FROM_APP_LOCALE[locale],
    myLanguageSet: chosen !== null,
    sendWithoutPreview: me?.sendWithoutPreview === true,
  };
}

export function useSetMyTranslate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { translateLanguage?: TranslateLanguage; sendWithoutPreview?: boolean }) =>
      api('/me', { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export function useChatTranslate(jid: string) {
  return useQuery({
    queryKey: chatStateKey(jid),
    queryFn: () => api<ChatTranslateState>(`/chats/${enc(jid)}/live-translate`),
    staleTime: 30_000,
  });
}

export function useSetChatTranslate(jid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChatTranslateBody) =>
      api<ChatTranslateState>(`/chats/${enc(jid)}/live-translate`, { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(chatStateKey(jid), data),
  });
}

/** The customer's language: chosen by the team, else detected. */
export function customerLanguageOf(chat: ChatTranslateState | undefined): TranslateLanguage | null {
  return chat?.customerLanguage ?? chat?.detected ?? null;
}

/** The language a reply goes out in: the customer's (a direct chat) or the group's one language. */
export function outgoingLanguageOf(
  chat: ChatTranslateState | undefined,
  isGroup: boolean,
): TranslateLanguage | null {
  return isGroup
    ? (chat?.outgoingLanguage ?? chat?.outgoingDetected ?? null)
    : customerLanguageOf(chat);
}

/** What a bubble shows for one message, from the server's answer (or why there is none). */
export type BubbleTranslation =
  | { kind: 'translated'; text: string; from: TranslateLanguage }
  | {
      kind: 'failed';
      code: 'unsafe' | 'limit' | 'ai' | 'offline' | 'error';
      from?: TranslateLanguage;
    };

type Entry = { body: string; tr: MessageTranslation | { status: 'offline' } };
type EntryMap = Record<string, Entry>;

function toBubble(tr: Entry['tr']): BubbleTranslation | null {
  switch (tr.status) {
    case 'ok':
      return { kind: 'translated', text: tr.text, from: tr.from };
    case 'unsafe':
      return { kind: 'failed', code: 'unsafe', from: tr.from };
    case 'limit':
      return { kind: 'failed', code: 'limit' };
    case 'ai_unavailable':
      return { kind: 'failed', code: 'ai' };
    case 'offline':
      return { kind: 'failed', code: 'offline' };
    case 'failed':
      return { kind: 'failed', code: 'error' };
    case 'same_language':
      return null;
  }
}

/** Everything a bubble needs, shared through the conversation. */
export interface ChatTranslateContextValue {
  active: boolean;
  my: TranslateLanguage;
  showOriginals: boolean;
  translations: Record<string, BubbleTranslation | null>;
  pending: boolean;
  retry(): void;
}

export const ChatTranslateContext = createContext<ChatTranslateContextValue | null>(null);

export function useBubbleTranslation(m: TranslatableMessage) {
  const ctx = useContext(ChatTranslateContext);
  if (!ctx) return null;
  return { ctx, tr: ctx.translations[m.id] ?? null };
}

/** Texts that need a translation: with a typed record the writer's own text is already known, so no call. */
export function needsTranslation(m: TranslatableMessage): boolean {
  return (
    !!m.body &&
    !m.id.startsWith('local-') &&
    !m.deletedAt &&
    m.type !== 'system' &&
    !(m.fromMe && m.typed)
  );
}

const BATCH = 50;

/**
 * Translations of the loaded text messages, only while Live translate is on. The server caches them per message,
 * revision and target language (a reload or a teammate with the same language costs nothing); here each answer is
 * kept in the query cache so a message is asked for once. A failed ask is shown on the bubble and retried only by
 * the person ("Try again"), never by itself.
 */
export function useChatTranslations(
  jid: string,
  messages: readonly TranslatableMessage[],
  my: TranslateLanguage,
  active: boolean,
) {
  const qc = useQueryClient();
  const key = translationsKey(jid, my);
  const cache = useQuery<EntryMap>({ queryKey: key, queryFn: skipToken, staleTime: Infinity });
  const entries = cache.data;
  const [pending, setPending] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const inFlight = useRef(false);
  const retryIds = useRef(new Set<string>());

  const todo = useMemo(() => {
    if (!active) return [];
    return messages
      .filter(needsTranslation)
      .filter((m) => {
        const e = entries?.[m.id];
        if (!e || e.body !== m.body) return true;
        return retryIds.current.has(m.id);
      })
      .slice(-BATCH);
    // retryTick: "Try again" re-asks the failed ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, messages, entries, retryTick]);

  useEffect(() => {
    if (todo.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const asked = todo.map((m) => ({ id: m.id, body: m.body ?? '' }));
    const merge = (fn: (old: EntryMap) => EntryMap) =>
      qc.setQueryData<EntryMap>(key, (old) => fn(old ?? {}));
    api<TranslationsResponse>(`/chats/${enc(jid)}/translations`, {
      method: 'POST',
      body: { messageIds: asked.map((a) => a.id), target: my },
    })
      .then((res) =>
        merge((old) => {
          const next = { ...old };
          for (const a of asked) {
            const tr = res.translations[a.id];
            next[a.id] = { body: a.body, tr: tr ?? { status: 'failed' } };
          }
          return next;
        }),
      )
      .catch((e: unknown) =>
        merge((old) => {
          const next = { ...old };
          const tr: Entry['tr'] =
            e instanceof ApiError && e.code === 'network'
              ? { status: 'offline' }
              : { status: 'failed' };
          for (const a of asked) next[a.id] = { body: a.body, tr };
          return next;
        }),
      )
      .finally(() => {
        for (const a of asked) retryIds.current.delete(a.id);
        inFlight.current = false;
        setPending(false);
        void qc.invalidateQueries({ queryKey: statusKey });
      });
  }, [todo, qc, key, jid, my]);

  const translations = useMemo(() => {
    const out: Record<string, BubbleTranslation | null> = {};
    for (const m of messages) {
      const e = entries?.[m.id];
      if (e && e.body === m.body) out[m.id] = toBubble(e.tr);
    }
    return out;
  }, [messages, entries]);

  const retry = useCallback(() => {
    for (const m of messages) {
      const s = entries?.[m.id]?.tr.status;
      if (s && s !== 'ok' && s !== 'same_language' && s !== 'unsafe') retryIds.current.add(m.id);
    }
    setRetryTick((n) => n + 1);
  }, [messages, entries]);

  return { translations, pending, retry };
}

/** What this tab already holds of a chat's translations, for one chat-list row. */
function cachedLastTranslation(
  qc: QueryClient,
  me: (MeTranslate & { id?: number }) | null | undefined,
  locale: Locale,
  jid: string,
  preview: string | null,
): string | null {
  if (!preview) return null;
  if (!qc.getQueryData<ChatTranslateState>(chatStateKey(jid))?.on) return null;
  const my = me?.translateLanguage ?? FROM_APP_LOCALE[locale];
  const cache = qc.getQueryData<EntryMap>(translationsKey(jid, my));
  if (!cache) return null;
  const head = preview.replace(/…$/, '');
  for (const e of Object.values(cache)) {
    if (e.tr.status === 'ok' && e.body.startsWith(head)) return e.tr.text;
  }
  return null;
}

/** Bumped when a translation, a chat's switch or my language changes (what the list rows read). */
let cacheVersion = 0;

/**
 * The translated last message of each listed chat where my switch is on, from what this tab already holds
 * (chats opened here). The list never asks the AI. Works without a query client (then nothing is translated).
 */
export function useCachedLastTranslations(
  chats: readonly { jid: string; lastMessagePreview: string | null }[],
): ReadonlyMap<string, string> {
  const qc = useContext(QueryClientContext);
  const locale = useLocale();
  const version = useSyncExternalStore(
    (notify) =>
      qc
        ? qc.getQueryCache().subscribe((event) => {
            // Only a finished write (never a query being created while another component renders).
            if (event.type !== 'updated' || event.action.type !== 'success') return;
            const k = event.query.queryKey;
            if (k[0] !== 'live-translate' && k[0] !== 'me') return;
            cacheVersion += 1;
            notify();
          })
        : () => undefined,
    () => cacheVersion,
    () => 0,
  );
  return useMemo(() => {
    const out = new Map<string, string>();
    if (!qc) return out;
    const me = qc.getQueryData<(MeTranslate & { id?: number }) | null>(qk.me);
    for (const c of chats) {
      const text = cachedLastTranslation(qc, me, locale, c.jid, c.lastMessagePreview);
      if (text) out.set(c.jid, text);
    }
    return out;
    // `version` re-reads the caches when a translation or my language changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, chats, locale, version]);
}

/** The text for the customer, checked on the server (protected items kept). Nothing is stored or sent. */
export function translateDraft(jid: string, body: { text: string; target: TranslateLanguage }) {
  return api<TranslateDraft>(`/chats/${enc(jid)}/translate-draft`, { method: 'POST', body });
}

/** Chat-level "Show originals", kept per chat for this browser tab. */
export function useShowOriginals(jid: string) {
  const key = `liveTranslate.originals.${jid}`;
  const [value, setValue] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, value ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message } from '@ezychat/shared';
import { api } from '@/api/client';
import { useLocale } from '@/i18n/locale-store';

/**
 * Proposed (live-translate): client side of the mock. The app will carry the switch and "My language" in
 * the bootstrap payload and the per-chat state in the chat; the mock asks its `/api/mock/live-translate` routes.
 */

export const LANGS = ['ms', 'en', 'zh', 'id', 'ta', 'th', 'vi', 'ar', 'ja', 'ko'] as const;
export type Lang = (typeof LANGS)[number];

/** Each language in its own name (the picker shows these, as WhatsApp does). */
export const NATIVE: Record<Lang, string> = {
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

export type MockScenario =
  'normal' | 'slow' | 'error' | 'limit' | 'no_connection' | 'number_changed';

export interface LiveTranslateStatus {
  enabled: boolean;
  model: 'fast' | 'main';
  dailyLimit: number;
  connected: boolean;
  scenario: MockScenario;
  myLanguage: Lang;
  myLanguageSet: boolean;
  usedByMe: number;
  usedToday: number;
  peopleToday: number;
}

export interface ChatTranslateState {
  on: boolean;
  customerLanguage: Lang | null;
  detected: Lang | null;
}

export type BubbleTranslation =
  | { kind: 'translated'; text: string; from: Lang }
  | { kind: 'failed'; code: string; from: Lang }
  | { kind: 'written'; original: string; from: Lang; to: Lang; edited: boolean; by: number | null };

export const statusKey = ['mock', 'live-translate'] as const;

export function useLiveTranslateStatus() {
  const locale = useLocale();
  return useQuery({
    queryKey: [...statusKey, locale],
    queryFn: () =>
      api<LiveTranslateStatus>(`/mock/live-translate?locale=${encodeURIComponent(locale)}`),
  });
}

export function useSetMyLanguage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (myLanguage: Lang) =>
      api<LiveTranslateStatus>('/mock/live-translate/me', { method: 'PUT', body: { myLanguage } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mock', 'live-translate'] }),
  });
}

export function useSetScenario() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (scenario: MockScenario) =>
      api<LiveTranslateStatus>('/mock/live-translate/scenario', {
        method: 'PUT',
        body: { scenario },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mock', 'live-translate'] }),
  });
}

const chatKey = (jid: string) => ['mock', 'live-translate', 'chat', jid] as const;

export function useChatTranslate(jid: string) {
  return useQuery({
    queryKey: chatKey(jid),
    queryFn: () => api<ChatTranslateState>(`/mock/live-translate/chats/${encodeURIComponent(jid)}`),
  });
}

export function useSetChatTranslate(jid: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { on?: boolean; customerLanguage?: Lang | null }) =>
      api<ChatTranslateState>(`/mock/live-translate/chats/${encodeURIComponent(jid)}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (data) => {
      client.setQueryData(chatKey(jid), data);
      void client.invalidateQueries({ queryKey: ['mock', 'live-translate', 'messages', jid] });
    },
  });
}

/** Everything a bubble needs, shared through the conversation. */
export interface ChatTranslateContextValue {
  jid: string;
  active: boolean;
  my: Lang;
  customer: Lang | null;
  showOriginals: boolean;
  translations: Record<string, BubbleTranslation>;
  pending: boolean;
  retry(): void;
  nameOf(userId: number): string | null;
}

export const ChatTranslateContext = createContext<ChatTranslateContextValue | null>(null);

export function useBubbleTranslation(m: Message) {
  const ctx = useContext(ChatTranslateContext);
  if (!ctx || !m.body) return null;
  return { ctx, tr: ctx.translations[m.id] ?? null };
}

/**
 * Asks for the translations of the visible text messages. Translated ones are cached by the server per
 * message and language, so re-opening a chat costs nothing.
 */
export function useChatTranslations(
  jid: string,
  messages: Message[],
  my: Lang,
  active: boolean,
  scenario: MockScenario | undefined,
) {
  const items = useMemo(
    () =>
      messages
        .filter((m) => m.body && !m.id.startsWith('local-'))
        .map((m) => ({ id: m.id, body: m.body!, fromMe: m.fromMe })),
    [messages],
  );
  const signature = items.map((i) => i.id).join(',');
  const [tick, setTick] = useState(0);
  const q = useQuery({
    queryKey: ['mock', 'live-translate', 'messages', jid, my, active, signature, scenario, tick],
    queryFn: () =>
      api<{ translations: Record<string, BubbleTranslation> }>(
        `/mock/live-translate/chats/${encodeURIComponent(jid)}/messages`,
        { method: 'POST', body: { to: my, translate: active, messages: items } },
      ),
    placeholderData: (prev) => prev,
    enabled: items.length > 0,
  });
  return {
    translations: q.data?.translations ?? {},
    pending: q.isFetching,
    retry: () => setTick((n) => n + 1),
  };
}

export type PreviewResult =
  | { status: 'ok'; text: string; back: string; from: Lang; to: Lang }
  | { status: 'refused'; reason: 'changed'; items: string[] };

export function previewTranslation(jid: string, body: { text: string; from: Lang; to: Lang }) {
  return api<PreviewResult>(`/mock/live-translate/chats/${encodeURIComponent(jid)}/preview`, {
    method: 'POST',
    body,
  });
}

export function rememberSent(
  jid: string,
  body: { text: string; original: string; from: Lang; to: Lang; edited: boolean },
) {
  return api(`/mock/live-translate/chats/${encodeURIComponent(jid)}/sent`, {
    method: 'POST',
    body,
  });
}

/** Chat-level "Show originals", kept per chat for this browser tab. */
export function useShowOriginals(jid: string) {
  const key = `mock.liveTranslate.originals.${jid}`;
  const [value, setValue] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      sessionStorage.setItem(key, value ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Mock only: the next message Tan Wei Jie sends ("Customer writes"). */
export const NEXT_CUSTOMER = {
  chatJid: '60127020388@s.whatsapp.net',
  senderName: 'Tan Wei Jie',
  text: '好的，那我要 2 盒 Kopi O 粉，明天可以来拿吗？',
};

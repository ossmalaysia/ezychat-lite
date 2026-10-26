import { useQuery } from '@tanstack/react-query';
import {
  ReplyCompleteResult,
  ReplyPhraseList,
  ReplyPhrasesAdmin,
  ReplySuggestModelInfo,
  ReplySuggestionsResult,
  ReplySuggestionsStatus,
} from '@ezychat/shared';
import { api } from './client';

/** The team-wide switch and what the composer shows (any signed-in user may read it). */
export const replySuggestionsKey = ['ai', 'replySuggestions'] as const;

export function useReplySuggestionsStatus(enabled = true) {
  return useQuery({
    queryKey: replySuggestionsKey,
    queryFn: () => api('/reply-suggestions', { schema: ReplySuggestionsStatus }),
    staleTime: 60_000,
    enabled,
  });
}

/** Up to 2 drafts for a direct chat (nothing is sent). */
export function fetchSuggestions(jid: string, signal: AbortSignal) {
  return api(`/chats/${encodeURIComponent(jid)}/ai/suggestions`, {
    method: 'POST',
    schema: ReplySuggestionsResult,
    signal,
  });
}

/** The chat's phrase list, matched in the composer on every key (empty while suggestions are off). */
export function usePhraseList(jid: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['ai', 'phraseList', jid] as const,
    queryFn: () =>
      api(`/chats/${encodeURIComponent(jid!)}/ai/phrases`, { schema: ReplyPhraseList }),
    enabled: enabled && !!jid,
    staleTime: 5 * 60_000,
  });
}

/** Tab / Accept (true) or Esc (false) on a phrase's grey text: it moves up or down the list. */
export function sendPhraseFeedback(jid: string, id: number, accepted: boolean) {
  void api(`/chats/${encodeURIComponent(jid)}/ai/phrases/${id}/feedback`, {
    method: 'POST',
    body: { accepted },
  }).catch(() => undefined);
}

export const phrasesAdminKey = ['ai', 'phrasesAdmin'] as const;

/** Admins: the phrase list and its status for one agent (default: the agent of inbox 1). */
export function usePhrasesAdmin(agentId: number | null) {
  return useQuery({
    queryKey: [...phrasesAdminKey, agentId] as const,
    queryFn: () =>
      // An empty agentId = the agent of inbox 1.
      api(`/ai/phrases?agentId=${agentId ?? ''}`, {
        schema: ReplyPhrasesAdmin,
      }),
    // While a build runs, ask again until it is done.
    refetchInterval: (query) => (query.state.data?.status.state === 'building' ? 1_500 : false),
  });
}

export const suggestModelKey = ['ai', 'suggestModel'] as const;

/** Admins: the model for suggestions, its choices and what calls use now. */
export function useSuggestModel(enabled: boolean) {
  return useQuery({
    queryKey: suggestModelKey,
    queryFn: () => api('/ai/reply-suggestions/model', { schema: ReplySuggestModelInfo }),
    enabled,
  });
}

/** The rest of the sentence being typed, or null. */
export function fetchCompletion(jid: string, text: string, signal: AbortSignal) {
  return api(`/chats/${encodeURIComponent(jid)}/ai/complete`, {
    body: { text },
    schema: ReplyCompleteResult,
    signal,
  });
}

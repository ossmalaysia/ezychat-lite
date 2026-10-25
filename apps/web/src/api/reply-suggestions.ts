import { useQuery } from '@tanstack/react-query';
import {
  ReplyCompleteResult,
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

/** The rest of the sentence being typed, or null. */
export function fetchCompletion(jid: string, text: string, signal: AbortSignal) {
  return api(`/chats/${encodeURIComponent(jid)}/ai/complete`, {
    body: { text },
    schema: ReplyCompleteResult,
    signal,
  });
}

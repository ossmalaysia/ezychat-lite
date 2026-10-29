import { useQuery } from '@tanstack/react-query';
import { FixEnglishStatus, FixGrammarResult, TeamWordsResult } from '@ezychat/shared';
import { api } from './client';

/** The team-wide switch and what the composer checks (any signed-in user may read it). */
export const fixEnglishKey = ['fixEnglish', 'status'] as const;

export function useFixEnglishStatus(enabled = true) {
  return useQuery({
    queryKey: fixEnglishKey,
    queryFn: () => api('/fix-english', { schema: FixEnglishStatus }),
    staleTime: 60_000,
    enabled,
  });
}

/** Team words and the Business context words: never marked as a spelling mistake. */
export const teamWordsKey = ['fixEnglish', 'words'] as const;

export function useTeamWords(enabled = true) {
  return useQuery({
    queryKey: teamWordsKey,
    queryFn: () => api('/fix-english/words', { schema: TeamWordsResult }),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function addTeamWord(word: string) {
  return api('/fix-english/words', { method: 'POST', body: { word }, schema: TeamWordsResult });
}

export function removeTeamWord(word: string) {
  return api(`/fix-english/words/${encodeURIComponent(word)}`, {
    method: 'DELETE',
    schema: TeamWordsResult,
  });
}

/** The grammar marks for the draft, from the AI (nothing is sent or stored). */
export function fetchGrammar(jid: string, text: string, signal: AbortSignal) {
  return api(`/chats/${encodeURIComponent(jid)}/ai/fix-grammar`, {
    method: 'POST',
    body: { text },
    schema: FixGrammarResult,
    signal,
  });
}

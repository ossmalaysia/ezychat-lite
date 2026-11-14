import { useQuery, type QueryClient } from '@tanstack/react-query';
import { HiddenChatsInfo, type ChatDetailResponse } from '@ezychat/shared';
import { api } from './client';
import { removeChatFromCache } from './chat-delete';
import { qk, type ChatsData } from './queries';

/**
 * Hide chats on Log out (docs/features/chat-hide-delete/design.md Part A): when a linked phone logs
 * out, every chat of its inbox is hidden (never deleted) until the same number links again.
 */

/** Every read of one inbox's hidden-chat counts (any connection state). */
export const hiddenChatsKey = (inboxId: number) => ['hidden-chats', inboxId] as const;

/**
 * Admins: how many chats Log out hides (`visible`) and how many are hidden for the inbox's number.
 * `state` (the connection state) is part of the key, so the counts are read again when it changes.
 */
export function useHiddenChats(inboxId: number, state: string, enabled = true) {
  return useQuery({
    queryKey: [...hiddenChatsKey(inboxId), state] as const,
    queryFn: () => api(`/inboxes/${inboxId}/hidden-chats`, { schema: HiddenChatsInfo }),
    enabled,
    staleTime: 0,
  });
}

/**
 * The inbox's phone logged out: its chats leave every cache (the chat lists, each chat and its
 * messages; the saved copy on this device follows on its next save), and the lists load again.
 */
export function removeInboxChatsFromCache(qc: QueryClient, inboxId: number): void {
  const jids = new Set<string>();
  for (const [, data] of qc.getQueriesData<ChatsData>({ queryKey: qk.chatsAll }))
    for (const page of data?.pages ?? [])
      for (const c of page.chats) if (c.inboxId === inboxId) jids.add(c.jid);
  // a chat opened by link that is in no list page
  for (const [key, data] of qc.getQueriesData<ChatDetailResponse>({ queryKey: ['chat'] }))
    if (data?.chat?.inboxId === inboxId && typeof key[1] === 'string') jids.add(key[1]);
  for (const jid of jids) removeChatFromCache(qc, jid);
  void qc.invalidateQueries({ queryKey: qk.chatsAll });
  // also when no chat of the inbox was cached (e.g. on an Admin page): the count leaves hidden chats out
  void qc.invalidateQueries({ queryKey: qk.unreadChatCount });
  void qc.invalidateQueries({ queryKey: hiddenChatsKey(inboxId) });
}

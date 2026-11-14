import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ChatDeletePreview } from '@ezychat/shared';
import { api } from './client';
import { qk, type ChatsData } from './queries';

/**
 * Delete chat (admins, docs/features/chat-hide-delete/design.md Part B): the chat, its messages,
 * notes and files go for good in EzyChat; the WhatsApp phone keeps its copy.
 */

/**
 * Drops a deleted chat from every cache: the chat lists (the saved copy on this device follows on
 * its next save), the chat, its messages, notes, profile and group members.
 */
export function removeChatFromCache(qc: QueryClient, jid: string): void {
  qc.setQueriesData<ChatsData>({ queryKey: qk.chatsAll }, (old) =>
    old?.pages
      ? {
          ...old,
          pages: old.pages.map((p) => ({ ...p, chats: p.chats.filter((c) => c.jid !== jid) })),
        }
      : old,
  );
  for (const key of [
    qk.chat(jid),
    qk.messages(jid),
    qk.notes(jid),
    qk.customerProfile(jid),
    qk.groupMembers(jid),
  ])
    qc.removeQueries({ queryKey: key, exact: true });
  void qc.invalidateQueries({ queryKey: qk.openChatCount });
  void qc.invalidateQueries({ queryKey: qk.unreadChatCount });
}

const chatDeletePreviewKey = (jid: string) => ['chat-delete-preview', jid] as const;

/** What a delete removes (messages and files), for the confirmation; admins only. */
export function useChatDeletePreview(jid: string, enabled: boolean) {
  return useQuery({
    queryKey: chatDeletePreviewKey(jid),
    queryFn: () =>
      api(`/chats/${encodeURIComponent(jid)}/delete-preview`, { schema: ChatDeletePreview }),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jid: string) =>
      api<undefined>(`/chats/${encodeURIComponent(jid)}`, { method: 'DELETE' }),
    onSuccess: (_res, jid) => removeChatFromCache(qc, jid),
  });
}

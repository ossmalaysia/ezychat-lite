import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message, SendTemplateBodyInput, TemplateListResponse } from '@ezychat/shared';
import { api } from './client';
import { qk, upsertMessageInCache } from './queries';

const enc = encodeURIComponent;

export const templatesKey = (inboxId: number) => ['templates', inboxId] as const;

/** Approved message templates of a Business API inbox (`GET /api/inboxes/:id/templates`). */
export function useTemplates(inboxId: number, enabled: boolean) {
  return useQuery({
    queryKey: templatesKey(inboxId),
    queryFn: ({ signal }) => api<TemplateListResponse>(`/inboxes/${inboxId}/templates`, { signal }),
    enabled,
    staleTime: 60_000,
  });
}

/** Sync: reads the templates again from WhatsApp (`?refresh=1`) and replaces the cached list. */
export function useSyncTemplates(inboxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<TemplateListResponse>(`/inboxes/${inboxId}/templates?refresh=1`),
    onSuccess: (data) => qc.setQueryData(templatesKey(inboxId), data),
  });
}

/** Sends an approved template into a chat (also after its reply window closed). */
export function useSendTemplate(jid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendTemplateBodyInput) =>
      api<Message>(`/chats/${enc(jid)}/template`, { method: 'POST', body }),
    onSuccess: (m) => {
      if (m && typeof m === 'object' && 'id' in m) upsertMessageInCache(qc, m);
      void qc.invalidateQueries({ queryKey: qk.chatsAll });
    },
  });
}

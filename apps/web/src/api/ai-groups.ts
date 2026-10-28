import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AiAgentGroups, AiGroupChat, type AiGroupChatBody } from '@ezychat/shared';
import { api } from './client';

/**
 * AI agents in WhatsApp groups (design docs/features/ai-groups/design.md): the agent's "Answer in
 * groups" switch with the groups of its inbox (admins), and each group's own switch.
 */
export const aiGroupsKey = ['ai-groups'] as const;
export const agentGroupsKey = (agentId: number) => [...aiGroupsKey, 'agent', agentId] as const;
export const groupChatAiKey = (jid: string) => [...aiGroupsKey, 'chat', jid] as const;

export function useAgentGroups(agentId: number) {
  return useQuery({
    queryKey: agentGroupsKey(agentId),
    queryFn: ({ signal }) => api(`/ai/agents/${agentId}/groups`, { signal, schema: AiAgentGroups }),
  });
}

export function useSetAnswerInGroups(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api(`/ai/agents/${agentId}/groups`, {
        method: 'PUT',
        body: { enabled },
        schema: AiAgentGroups,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(agentGroupsKey(agentId), saved);
      void qc.invalidateQueries({ queryKey: [...aiGroupsKey, 'chat'] });
    },
  });
}

/** Whether the AI answers tags and quotes in this group (anyone who may open the chat). */
export function useGroupChatAi(jid: string | null) {
  return useQuery({
    queryKey: groupChatAiKey(jid ?? ''),
    queryFn: ({ signal }) =>
      api(`/chats/${encodeURIComponent(jid ?? '')}/ai-group`, { signal, schema: AiGroupChat }),
    enabled: jid !== null,
    retry: false,
  });
}

/** Admins: switch one group on or off (Group info and the agent page list). */
export function useSetGroupChatAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jid, enabled }: AiGroupChatBody & { jid: string }) =>
      api(`/chats/${encodeURIComponent(jid)}/ai-group`, {
        method: 'PUT',
        body: { enabled } satisfies AiGroupChatBody,
        schema: AiGroupChat,
      }),
    onSuccess: (saved, { jid }) => {
      qc.setQueryData(groupChatAiKey(jid), saved);
      qc.setQueriesData<AiAgentGroups>({ queryKey: [...aiGroupsKey, 'agent'] }, (old) =>
        old
          ? {
              ...old,
              groups: old.groups.map((g) => (g.jid === jid ? { ...g, enabled: saved.enabled } : g)),
            }
          : old,
      );
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AiAgentGroups,
  AiGroupChat,
  type AiAgentGroupsBody,
  type AiGroupSetting,
} from '@ezychat/shared';
import { api } from './client';

/**
 * AI agents in WhatsApp groups (designs docs/features/ai-groups/design.md and
 * docs/features/ai-groups-open-chat/design.md): the agent's group settings with the groups of its
 * inbox (admins), and each group's own choice.
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

/** Admins: "Answer in groups", which groups and the default mode (any of them). */
export function useSetAnswerInGroups(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiAgentGroupsBody) =>
      api(`/ai/agents/${agentId}/groups`, {
        method: 'PUT',
        body: body satisfies AiAgentGroupsBody,
        schema: AiAgentGroups,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(agentGroupsKey(agentId), saved);
      void qc.invalidateQueries({ queryKey: [...aiGroupsKey, 'chat'] });
    },
  });
}

/** The group's choice and how the AI behaves there (anyone who may open the chat). */
export function useGroupChatAi(jid: string | null) {
  return useQuery({
    queryKey: groupChatAiKey(jid ?? ''),
    queryFn: ({ signal }) =>
      api(`/chats/${encodeURIComponent(jid ?? '')}/ai-group`, { signal, schema: AiGroupChat }),
    enabled: jid !== null,
    retry: false,
  });
}

/** Admins: one group's choice (Group info and the agent page list). */
export function useSetGroupChatAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jid, setting }: { jid: string; setting: AiGroupSetting }) =>
      api(`/chats/${encodeURIComponent(jid)}/ai-group`, {
        method: 'PUT',
        body: { setting },
        schema: AiGroupChat,
      }),
    onSuccess: (saved, { jid }) => {
      qc.setQueryData(groupChatAiKey(jid), saved);
      qc.setQueriesData<AiAgentGroups>({ queryKey: [...aiGroupsKey, 'agent'] }, (old) =>
        old
          ? {
              ...old,
              groups: old.groups.map((g) =>
                g.jid === jid
                  ? { ...g, enabled: saved.enabled, setting: saved.setting, mode: saved.mode }
                  : g,
              ),
            }
          : old,
      );
    },
  });
}

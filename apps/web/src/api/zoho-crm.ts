import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ZohoCrmActivityList,
  ZohoCrmAgentSettings,
  ZohoCrmChatRecord,
  ZohoCrmConnectProgress,
  ZohoCrmConnectStart,
  ZohoCrmStatus,
  type ZohoRegion,
} from '@ezychat/shared';
import { api } from './client';

/** Admin → Connectors → Zoho CRM (admins only). Tokens never reach the browser. */
export const zohoCrmKey = ['connectors', 'zoho-crm'] as const;
export const zohoCrmSettingsKey = (agentId: number) => [...zohoCrmKey, 'agent', agentId] as const;
export const zohoCrmActivityKey = [...zohoCrmKey, 'activity'] as const;
/** The customer panel's record of one chat (every teammate who may open the chat). */
export const zohoCrmChatKey = (jid: string) => ['zoho-crm-chat', jid] as const;

export function useZohoCrm(enabled = true) {
  return useQuery({
    queryKey: zohoCrmKey,
    queryFn: ({ signal }) => api('/connectors/zoho-crm', { signal, schema: ZohoCrmStatus }),
    enabled,
  });
}

/** Starts Zoho's sign-in in the chosen data centre: the page opens `authorizationUrl` and polls. */
export function useZohoCrmConnect() {
  return useMutation({
    mutationFn: (region: ZohoRegion) =>
      api('/connectors/zoho-crm/connect', {
        method: 'POST',
        body: { region },
        schema: ZohoCrmConnectStart,
      }),
  });
}

/** Polls a sign-in every 2 s until Zoho sent the person back (done) or it failed. */
export function useZohoCrmProgress(requestId: string | null) {
  return useQuery({
    queryKey: [...zohoCrmKey, 'connect', requestId] as const,
    queryFn: ({ signal }) =>
      api(`/connectors/zoho-crm/connect/${encodeURIComponent(requestId ?? '')}`, {
        signal,
        schema: ZohoCrmConnectProgress,
      }),
    enabled: requestId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
    gcTime: 0,
  });
}

export function useZohoCrmDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/connectors/zoho-crm/disconnect', { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: zohoCrmKey }),
  });
}

/** One AI agent's Zoho CRM settings (the defaults until an admin saves them). */
export function useZohoCrmSettings(agentId: number | null, enabled = true) {
  return useQuery({
    queryKey: zohoCrmSettingsKey(agentId ?? 0),
    queryFn: ({ signal }) =>
      api(`/connectors/zoho-crm/agents/${agentId}`, { signal, schema: ZohoCrmAgentSettings }),
    enabled: enabled && agentId !== null,
  });
}

export function useSaveZohoCrmSettings(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ZohoCrmAgentSettings) =>
      api(`/connectors/zoho-crm/agents/${agentId}`, {
        method: 'PUT',
        body,
        schema: ZohoCrmAgentSettings,
      }),
    onSuccess: (saved) => qc.setQueryData(zohoCrmSettingsKey(agentId), saved),
  });
}

export function useZohoCrmActivity(enabled = true) {
  return useQuery({
    queryKey: zohoCrmActivityKey,
    queryFn: ({ signal }) =>
      api('/connectors/zoho-crm/activity', { signal, schema: ZohoCrmActivityList }),
    enabled,
  });
}

export function useChatZohoCrm(jid: string, enabled = true) {
  return useQuery({
    queryKey: zohoCrmChatKey(jid),
    queryFn: ({ signal }) =>
      api(`/chats/${encodeURIComponent(jid)}/zoho-crm`, { signal, schema: ZohoCrmChatRecord }),
    enabled,
    staleTime: 60_000,
  });
}

/** "Add as a lead" (a teammate): the saved contact becomes a Zoho CRM lead. */
export function useAddChatZohoLead(jid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/chats/${encodeURIComponent(jid)}/zoho-crm/lead`, {
        method: 'POST',
        schema: ZohoCrmChatRecord,
      }),
    onSuccess: (data) => qc.setQueryData(zohoCrmChatKey(jid), data),
  });
}

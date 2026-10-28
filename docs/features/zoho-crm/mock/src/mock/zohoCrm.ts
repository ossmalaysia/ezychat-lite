import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

/** Proposed (zoho-crm): mirrors ../../zoho-crm.ts (the mock's stand-in routes). */
export type ZohoState = 'disconnected' | 'connected' | 'expired' | 'unavailable';

export const ZOHO_REGIONS = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'] as const;
export type ZohoRegion = (typeof ZOHO_REGIONS)[number];

export interface AgentCrm {
  find: boolean;
  addLeads: boolean;
  ownerId: string;
  leadSource: string;
  includeRequest: boolean;
}

export interface CrmActivity {
  at: number;
  kind: 'found' | 'not_found' | 'added' | 'added_by_team' | 'not_added';
  agent: string;
  customer: string;
  module?: 'Contacts' | 'Leads';
  reason?: 'exists' | 'no_name' | 'unavailable';
}

export interface ZohoCrmState {
  state: ZohoState;
  region: ZohoRegion | null;
  account: string | null;
  org: string | null;
  users: Array<{ id: string; name: string }>;
  agents: Record<string, AgentCrm>;
  activity: CrmActivity[];
}

export interface CrmRecord {
  module: 'Contacts' | 'Leads';
  id: string;
  name: string;
  company: string | null;
  owner: string;
  status: string | null;
  request: string | null;
  addedBy: 'ai' | 'team' | null;
  url: string;
}

export const DEFAULT_AGENT_CRM: AgentCrm = {
  find: true,
  addLeads: false,
  ownerId: 'default',
  leadSource: 'WhatsApp',
  includeRequest: true,
};

export const zohoCrmKey = ['mock', 'zohoCrm'] as const;

export function useZohoCrm() {
  return useQuery({ queryKey: zohoCrmKey, queryFn: () => api<ZohoCrmState>('/mock/zoho-crm') });
}

export function crmFor(state: ZohoCrmState | undefined, agentId: string): AgentCrm {
  return state?.agents[agentId] ?? DEFAULT_AGENT_CRM;
}

/** The organisation's CRM home in the browser, on the account's Zoho site. */
export function zohoCrmUrl(region: ZohoRegion): string {
  return `https://crm.zoho.${region}/crm/`;
}

export function useZohoCrmAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'connect'; region: ZohoRegion }
        | { kind: 'disconnect' }
        | { kind: 'state'; state: 'connected' | 'expired' | 'unavailable' }
        | { kind: 'agent'; agentId: string; crm: AgentCrm },
    ) => {
      if (action.kind === 'connect')
        return api<ZohoCrmState>('/mock/zoho-crm/connect', {
          method: 'POST',
          body: { region: action.region },
        });
      if (action.kind === 'disconnect')
        return api<ZohoCrmState>('/mock/zoho-crm/disconnect', { method: 'POST' });
      if (action.kind === 'state')
        return api<ZohoCrmState>('/mock/zoho-crm/state', {
          method: 'PUT',
          body: { state: action.state },
        });
      return api<ZohoCrmState>(`/mock/zoho-crm/agents/${encodeURIComponent(action.agentId)}`, {
        method: 'PUT',
        body: action.crm,
      });
    },
    onSuccess: (data) => {
      client.setQueryData(zohoCrmKey, data);
      void client.invalidateQueries({ queryKey: [...zohoCrmKey, 'chat'] });
    },
  });
}

/** Customer panel: the chat's record in Zoho CRM (or none). */
export function useChatCrmRecord(jid: string) {
  return useQuery({
    queryKey: [...zohoCrmKey, 'chat', jid],
    queryFn: () =>
      api<{ state: ZohoState; record: CrmRecord | null }>(
        `/mock/zoho-crm/chats/${encodeURIComponent(jid)}`,
      ),
  });
}

export function useAddChatLead(jid: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ state: ZohoState; record: CrmRecord | null }>(
        `/mock/zoho-crm/chats/${encodeURIComponent(jid)}/lead`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      client.setQueryData([...zohoCrmKey, 'chat', jid], data);
      void client.invalidateQueries({ queryKey: zohoCrmKey, exact: true });
    },
  });
}

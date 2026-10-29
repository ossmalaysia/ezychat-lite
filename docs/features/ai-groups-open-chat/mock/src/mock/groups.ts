import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useShownAgents } from './useAgents';
import { inboxOfChat, useMockInboxes } from './inboxes';
import type { MockAgent } from './agents';

/**
 * Proposed (ai-groups, ai-groups-open-chat), mock only: whether an AI agent answers in WhatsApp
 * groups, in which groups and how (Open chat or Tag and quote), as the stand-in routes
 * `/api/mock/groups*` serve it (../../groups.ts). Production: per-agent settings, a per-group
 * setting, the open-chat decision and the loop guard on the server.
 */
export type GroupMode = 'open' | 'tag';
/** A group's choice: the agent's mode, a mode of its own, or off. */
export type GroupSetting = 'default' | GroupMode | 'off';

export interface MockAgentGroups {
  /** "Answer in groups". */
  on: boolean;
  /** All groups (new groups too) or the selected groups only. */
  scope: 'all' | 'selected';
  /** The default mode of the agent's groups. */
  mode: GroupMode;
}

export interface MockGroupRow {
  jid: string;
  name: string;
  size: number | null;
  /** What the group's choice shows (a group not set follows the agent's scope). */
  setting: GroupSetting;
  /** How the AI behaves there now. */
  mode: GroupMode | 'off';
  enabled: boolean;
  /** AI answers since the last teammate message (the loop guard counts these). */
  inRow: number;
  paused: boolean;
  demo: boolean;
}

export interface MockGroupNotification {
  agent: string;
  group: string;
  member: string;
  question: string;
  to: string | null;
  at: number;
}

export interface MockGroupsView {
  agents: Record<string, MockAgentGroups>;
  loopGuardAnswers: number;
  loopGuard: boolean;
  viewAs: 'admin' | 'agent';
  notification: MockGroupNotification | null;
  groups: MockGroupRow[];
}

export type SimulateKind =
  | 'question'
  | 'followUp'
  | 'continue'
  | 'named'
  | 'open'
  | 'person'
  | 'unrelated'
  | 'sensitive'
  | 'sensitiveTagged'
  | 'handover'
  | 'teammate';
export type SimulateOutcome =
  'answered' | 'handover' | 'paused' | 'off' | 'silent' | 'declined' | 'teammate';

const key = ['mock', 'groups'] as const;

export function useMockGroups() {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<MockGroupsView>('/mock/groups', { signal }),
  });
}

function useGroupsMutation<I>(fn: (input: I) => Promise<MockGroupsView>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => client.setQueryData(key, view),
  });
}

export function useSetAnswerInGroups() {
  return useGroupsMutation(
    ({
      agentId,
      ...body
    }: { agentId: string; enabled?: boolean } & Partial<Pick<MockAgentGroups, 'scope' | 'mode'>>) =>
      api<MockGroupsView>(`/mock/groups/agents/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        body,
      }),
  );
}

export function useSetGroupAnswers() {
  return useGroupsMutation((input: { jid: string; setting: GroupSetting }) =>
    api<MockGroupsView>(`/mock/groups/chats/${encodeURIComponent(input.jid)}`, {
      method: 'PUT',
      body: { setting: input.setting },
    }),
  );
}

export function useGroupsScenario() {
  return useGroupsMutation(
    (input: { loopGuard?: boolean; viewAs?: 'admin' | 'agent'; reset?: boolean }) =>
      api<MockGroupsView>('/mock/groups/scenario', { method: 'PUT', body: input }),
  );
}

export function useSimulateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { jid: string; kind: SimulateKind }) =>
      api<{ outcome: SimulateOutcome; view: MockGroupsView }>('/mock/groups/simulate', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => client.setQueryData(key, data.view),
  });
}

export interface GroupAiState {
  row: MockGroupRow | undefined;
  /** The agent of the group's inbox (none: no agent answers there). */
  agent: MockAgent | undefined;
  /** The agent's "Answer in groups" settings. */
  agentGroups: MockAgentGroups | undefined;
  /** The agent's "Answer in groups" switch. */
  agentOn: boolean;
  /** The AI answers in this group now (in `row.mode`). */
  active: boolean;
  /** Admins change groups; agents (and the mock's agent view) only see the state. */
  canEdit: boolean;
  view: MockGroupsView | undefined;
}

/** Everything a group screen needs: the group's row, its inbox's agent and who may change it. */
export function useGroupAi(jid: string): GroupAiState {
  const q = useMockGroups();
  const inboxes = useMockInboxes();
  const { agents } = useShownAgents();
  const { user } = useAuth();
  const inbox = inboxOfChat(inboxes, jid);
  const agent = inbox ? agents.find((a) => a.inboxId === inbox.id) : undefined;
  const row = q.data?.groups.find((g) => g.jid === jid);
  const agentGroups = agent ? q.data?.agents[agent.id] : undefined;
  const agentOn = Boolean(agentGroups?.on);
  return {
    row,
    agent,
    agentGroups,
    agentOn,
    active: Boolean(row && row.mode !== 'off' && agentOn),
    canEdit: user?.role === 'admin' && q.data?.viewAs !== 'agent',
    view: q.data,
  };
}

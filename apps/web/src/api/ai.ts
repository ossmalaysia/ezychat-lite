import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AiAgentStatus,
  AiAgentSummary,
  AiDocumentView,
  AiEditResult,
  AiMemberStatus,
  AiModelList,
  AiTestResult,
  AiTryResult,
  type AiAgentBody,
  type AiMemberBody,
  type AiConnectionBody,
  type AiContextPatchBody,
  type AiContextTextBody,
  type AiEditBody,
  type AiTryBody,
} from '@ezychat/shared';
import { api, ApiError } from './client';
import { qk } from './queries';
import { voiceStatusKey } from './voice';

export const aiMemberKey = ['ai-member'] as const;

export function useAiMember() {
  return useQuery({
    queryKey: aiMemberKey,
    queryFn: ({ signal }) => api('/ai', { signal, schema: AiMemberStatus }),
    refetchInterval: (query) =>
      query.state.data?.connection.state === 'signing_in' ? 2000 : false,
  });
}

/** One Business context item with its text (full for text items, a preview for files). */
export function useAiDocument(id: number | null) {
  return useQuery({
    queryKey: ['ai-document', id] as const,
    queryFn: ({ signal }) => api(`/ai/documents/${id}`, { signal, schema: AiDocumentView }),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

/** EXPERIMENTAL direct ChatGPT sign-in: live models for the signed-in account (or a fallback). */
export function useAiModels(enabled: boolean, connected: boolean) {
  return useQuery({
    queryKey: ['ai-models', connected] as const,
    queryFn: ({ signal }) => api('/ai/models', { signal, schema: AiModelList }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useAiTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/ai/chatgpt/test', { method: 'POST', schema: AiTestResult }),
    onSettled: () => void qc.invalidateQueries({ queryKey: aiMemberKey }),
  });
}

/**
 * Try it: answers from the page's current knowledge; never touches chats or WhatsApp. With
 * `agentId` the answer uses that agent's saved items (and its path); without, the inbox-1 agent.
 */
export function useAiTry() {
  return useMutation({
    mutationFn: (body: AiTryBody) =>
      body.agentId === undefined
        ? api('/ai/try', { method: 'POST', body, schema: AiTryResult })
        : api(`/ai/agents/${body.agentId}/try`, { method: 'POST', body, schema: AiTryResult }),
  });
}

/**
 * Edit with AI: a suggested rewrite of one box; nothing is saved (the page's Save does that).
 * Pass a signal so closing the popup stops the (paid) model call. `agentId`: whose items inform it.
 */
export function useAiEdit(agentId?: number) {
  return useMutation({
    mutationFn: ({ body, signal }: { body: AiEditBody; signal: AbortSignal }) =>
      agentId === undefined
        ? api('/ai/edit', { method: 'POST', body, schema: AiEditResult, signal })
        : api(`/ai/agents/${agentId}/edit`, {
            method: 'POST',
            body,
            schema: AiEditResult,
            signal,
          }),
  });
}

export type AiMemberAction =
  | { kind: 'save'; settings: AiMemberBody }
  | { kind: 'connection'; settings: AiConnectionBody }
  | { kind: 'upload'; file: File }
  | { kind: 'remove'; id: number }
  | { kind: 'removeMany'; ids: number[] }
  | { kind: 'addText'; body: AiContextTextBody }
  | { kind: 'updateText'; id: number; body: AiContextPatchBody }
  | { kind: 'login' }
  | { kind: 'logout' }
  | { kind: 'callback'; url: string };

/** Some items of a batch delete failed (not 404); `failedIds` are the ones to retry. */
export class BatchDeleteError extends Error {
  constructor(
    readonly failedIds: number[],
    readonly firstError: unknown,
  ) {
    super(firstError instanceof Error ? firstError.message : 'Some items could not be deleted');
    this.name = 'BatchDeleteError';
  }
}

export function useAiMemberAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: AiMemberAction) => {
      const schema = AiMemberStatus;
      switch (action.kind) {
        case 'save':
          return api('/ai', { method: 'PUT', body: action.settings, schema });
        case 'connection':
          return api('/ai/connection', { method: 'PATCH', body: action.settings, schema });
        case 'upload': {
          const form = new FormData();
          form.append('file', action.file);
          return api('/ai/documents', { form, schema });
        }
        case 'remove':
          return api(`/ai/documents/${action.id}`, { method: 'DELETE', schema });
        case 'removeMany': {
          // One request per item, in order. 404 = already gone (counts as deleted); other errors
          // are collected so the caller can retry only those items.
          let status: AiMemberStatus | undefined;
          const failedIds: number[] = [];
          let firstError: unknown;
          for (const id of action.ids) {
            try {
              status = await api(`/ai/documents/${id}`, { method: 'DELETE', schema });
            } catch (error) {
              if (error instanceof ApiError && error.status === 404) {
                status = undefined;
                continue;
              }
              failedIds.push(id);
              firstError ??= error;
            }
          }
          if (failedIds.length > 0) throw new BatchDeleteError(failedIds, firstError);
          return status ?? api('/ai', { schema });
        }
        case 'addText':
          return api('/ai/documents/text', { method: 'POST', body: action.body, schema });
        case 'updateText':
          return api(`/ai/documents/${action.id}`, { method: 'PATCH', body: action.body, schema });
        case 'login':
          return api('/ai/chatgpt/login', { method: 'POST', schema });
        case 'logout':
          return api('/ai/chatgpt/logout', { method: 'POST', schema });
        case 'callback':
          return api('/ai/chatgpt/callback', { method: 'POST', body: { url: action.url }, schema });
      }
    },
    onSuccess: (status) => {
      qc.setQueryData(aiMemberKey, status);
      qc.removeQueries({ queryKey: ['ai-document'] });
      void qc.invalidateQueries({ queryKey: qk.users });
      // Cloud voice transcription depends on the saved API key.
      void qc.invalidateQueries({ queryKey: voiceStatusKey });
    },
    // A batch delete can fail part-way: reload what the server has now.
    onError: () => void qc.invalidateQueries({ queryKey: aiMemberKey }),
  });
}

// ---- AI agents (one per inbox; Lite has one) -------------------------------------------------

/** `GET /api/ai/agents` and `DELETE /api/ai/agents/:agentId`: every agent and the edition limit. */
export const AiAgentList = z.object({
  agents: z.array(AiAgentSummary),
  maxAgents: z.number().int(),
});
export type AiAgentList = z.infer<typeof AiAgentList>;

export const aiAgentsKey = ['ai-agents'] as const;
export const aiAgentKey = (agentId: number) => ['ai-agent', agentId] as const;
/** One item with its text, under its agent (the agent is part of the key and of the path). */
export const aiAgentDocumentKey = (agentId: number, id: number) =>
  ['ai-document', agentId, id] as const;

export function useAiAgents() {
  return useQuery({
    queryKey: aiAgentsKey,
    queryFn: ({ signal }) => api('/ai/agents', { signal, schema: AiAgentList }),
  });
}

/** One agent with its settings and items; `null` (a new agent) reads nothing. */
export function useAiAgent(agentId: number | null) {
  return useQuery({
    queryKey: aiAgentKey(agentId ?? 0),
    queryFn: ({ signal }) => api(`/ai/agents/${agentId}`, { signal, schema: AiAgentStatus }),
    enabled: agentId !== null,
  });
}

/** One Business context item of an agent with its text (full for text, a preview for files). */
export function useAiAgentDocument(agentId: number, id: number | null) {
  return useQuery({
    queryKey: aiAgentDocumentKey(agentId, id ?? 0),
    queryFn: ({ signal }) =>
      api(`/ai/agents/${agentId}/documents/${id}`, { signal, schema: AiDocumentView }),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

export type AiAgentAction =
  | { kind: 'create'; body: AiAgentBody }
  | { kind: 'save'; body: AiAgentBody }
  | { kind: 'delete' }
  | { kind: 'upload'; file: File; internal?: boolean }
  | { kind: 'addText'; body: AiContextTextBody }
  | { kind: 'updateText'; id: number; body: AiContextPatchBody }
  | { kind: 'remove'; id: number }
  | { kind: 'removeMany'; ids: number[] }
  /** Binds the agent to an inbox (Admin → Inboxes' route); null frees the inbox it answers now. */
  | { kind: 'setInbox'; inboxId: number | null };

async function deleteAgentItems(agentId: number, ids: number[]): Promise<AiAgentStatus> {
  // One request per item, in order. 404 = already gone (counts as deleted); other errors are
  // collected so the caller can retry only those items.
  let status: AiAgentStatus | undefined;
  const failedIds: number[] = [];
  let firstError: unknown;
  for (const id of ids) {
    try {
      status = await api(`/ai/agents/${agentId}/documents/${id}`, {
        method: 'DELETE',
        schema: AiAgentStatus,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) continue;
      failedIds.push(id);
      firstError ??= error;
    }
  }
  if (failedIds.length > 0) throw new BatchDeleteError(failedIds, firstError);
  return status ?? api(`/ai/agents/${agentId}`, { schema: AiAgentStatus });
}

async function setAgentInbox(agentId: number, inboxId: number | null): Promise<AiAgentStatus> {
  let target = inboxId;
  if (target === null)
    // "None": free the inbox the agent answers now (if any).
    target = (await api(`/ai/agents/${agentId}`, { schema: AiAgentStatus })).agent.inboxId;
  if (target !== null)
    await api(`/inboxes/${target}`, {
      method: 'PATCH',
      body: { aiAgentId: inboxId === null ? null : agentId },
    });
  return api(`/ai/agents/${agentId}`, { schema: AiAgentStatus });
}

function runAgentAction(
  agentId: number | null,
  action: AiAgentAction,
): Promise<AiAgentStatus | AiAgentList> {
  const schema = AiAgentStatus;
  if (action.kind === 'create') return api('/ai/agents', { body: action.body, schema });
  if (agentId === null) return Promise.reject(new Error('Save the AI agent first'));
  switch (action.kind) {
    case 'save':
      return api(`/ai/agents/${agentId}`, { method: 'PUT', body: action.body, schema });
    case 'delete':
      return api(`/ai/agents/${agentId}`, { method: 'DELETE', schema: AiAgentList });
    case 'upload': {
      // The server reads `internal` only when it comes before the file.
      const form = new FormData();
      if (action.internal) form.append('internal', 'true');
      form.append('file', action.file);
      return api(`/ai/agents/${agentId}/documents`, { form, schema });
    }
    case 'addText':
      return api(`/ai/agents/${agentId}/documents/text`, { body: action.body, schema });
    case 'updateText':
      return api(`/ai/agents/${agentId}/documents/${action.id}`, {
        method: 'PATCH',
        body: action.body,
        schema,
      });
    case 'remove':
      return api(`/ai/agents/${agentId}/documents/${action.id}`, { method: 'DELETE', schema });
    case 'removeMany':
      return deleteAgentItems(agentId, action.ids);
    case 'setInbox':
      return setAgentInbox(agentId, action.inboxId);
  }
}

/** Every open agent page: an inbox change can move another agent off its inbox. */
const allAgentsKey = ['ai-agent'] as const;

/** Everything that shows agents: the list, every agent, the old AI member view, members, inboxes. */
function refreshAgents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: aiAgentsKey });
  void qc.invalidateQueries({ queryKey: allAgentsKey });
  void qc.invalidateQueries({ queryKey: aiMemberKey });
  void qc.invalidateQueries({ queryKey: qk.users });
  void qc.invalidateQueries({ queryKey: qk.inboxes });
}

/** Changes one agent (or creates one with `agentId` null) and its Business context items. */
export function useAiAgentAction(agentId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: AiAgentAction) => runAgentAction(agentId, action),
    onSuccess: (result) => {
      if ('agent' in result) {
        qc.setQueryData(aiAgentKey(result.agent.id), result);
        qc.removeQueries({ queryKey: ['ai-document', result.agent.id] });
        refreshAgents(qc);
        return;
      }
      // Deleted: the server returns the agents that remain.
      qc.setQueryData(aiAgentsKey, result);
      if (agentId !== null) {
        qc.removeQueries({ queryKey: aiAgentKey(agentId) });
        qc.removeQueries({ queryKey: ['ai-document', agentId] });
      }
      refreshAgents(qc);
    },
    // A batch delete can fail part-way: reload what the server has now.
    onError: () => refreshAgents(qc),
  });
}

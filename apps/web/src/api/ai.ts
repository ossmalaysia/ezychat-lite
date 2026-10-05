import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AiMemberStatus,
  AiModelList,
  AiTestResult,
  type AiMemberBody,
  type AiConnectionBody,
} from '@wa-team-inbox/shared';
import { api } from './client';
import { qk } from './queries';

export const aiMemberKey = ['ai-member'] as const;

export function useAiMember() {
  return useQuery({
    queryKey: aiMemberKey,
    queryFn: ({ signal }) => api('/ai', { signal, schema: AiMemberStatus }),
    refetchInterval: (query) =>
      query.state.data?.connection.state === 'signing_in' ? 2000 : false,
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
  return useMutation({
    mutationFn: () => api('/ai/chatgpt/test', { method: 'POST', schema: AiTestResult }),
  });
}

export type AiMemberAction =
  | { kind: 'save'; settings: AiMemberBody }
  | { kind: 'connection'; settings: AiConnectionBody }
  | { kind: 'upload'; file: File }
  | { kind: 'remove'; id: number }
  | { kind: 'login' }
  | { kind: 'logout' };

export function useAiMemberAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: AiMemberAction) => {
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
        case 'login':
          return api('/ai/chatgpt/login', { method: 'POST', schema });
        case 'logout':
          return api('/ai/chatgpt/logout', { method: 'POST', schema });
      }
    },
    onSuccess: (status) => {
      qc.setQueryData(aiMemberKey, status);
      void qc.invalidateQueries({ queryKey: qk.users });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AiMemberStatus,
  AiModelList,
  AiTestResult,
  AiTryResult,
  type AiMemberBody,
  type AiConnectionBody,
  type AiTryBody,
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/ai/chatgpt/test', { method: 'POST', schema: AiTestResult }),
    onSettled: () => void qc.invalidateQueries({ queryKey: aiMemberKey }),
  });
}

/** Try it: answers from the page's current knowledge; never touches chats or WhatsApp. */
export function useAiTry() {
  return useMutation({
    mutationFn: (body: AiTryBody) => api('/ai/try', { method: 'POST', body, schema: AiTryResult }),
  });
}

export type AiMemberAction =
  | { kind: 'save'; settings: AiMemberBody }
  | { kind: 'connection'; settings: AiConnectionBody }
  | { kind: 'upload'; file: File }
  | { kind: 'remove'; id: number }
  | { kind: 'login' }
  | { kind: 'logout' }
  | { kind: 'callback'; url: string };

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
        case 'callback':
          return api('/ai/chatgpt/callback', { method: 'POST', body: { url: action.url }, schema });
      }
    },
    onSuccess: (status) => {
      qc.setQueryData(aiMemberKey, status);
      void qc.invalidateQueries({ queryKey: qk.users });
    },
  });
}

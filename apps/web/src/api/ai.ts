import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AiDocumentView,
  AiMemberStatus,
  AiModelList,
  AiTestResult,
  AiTryResult,
  type AiMemberBody,
  type AiConnectionBody,
  type AiContextPatchBody,
  type AiContextTextBody,
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
  | { kind: 'removeMany'; ids: number[] }
  | { kind: 'addText'; body: AiContextTextBody }
  | { kind: 'updateText'; id: number; body: AiContextPatchBody }
  | { kind: 'login' }
  | { kind: 'logout' }
  | { kind: 'callback'; url: string };

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
          // One request per item, in order; the last response is the current status.
          let status: AiMemberStatus | undefined;
          for (const id of action.ids)
            status = await api(`/ai/documents/${id}`, { method: 'DELETE', schema });
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
    },
    // A batch delete can fail part-way: reload what the server has now.
    onError: () => void qc.invalidateQueries({ queryKey: aiMemberKey }),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DreamChange,
  DreamChangeDetail,
  DreamHistory,
  DreamSettings,
  type DreamSettingsBody,
} from '@ezychat/shared';
import { aiAgentKey } from './ai';
import { api } from './client';

/**
 * Dream mode of one AI agent (design docs/superpowers/specs/2026-11-14-dream-mode-design.md, admins only): settings,
 * the nightly history, one change and Apply / Dismiss / Undo. Every change reads the history (and the agent) again.
 */
export const dreamKey = (agentId: number) => ['dream', agentId] as const;
export const dreamChangeKey = (agentId: number, id: number) =>
  [...dreamKey(agentId), 'change', id] as const;

export function useDream(agentId: number) {
  return useQuery({
    queryKey: dreamKey(agentId),
    queryFn: ({ signal }) => api(`/ai/agents/${agentId}/dream`, { signal, schema: DreamHistory }),
  });
}

export function useSaveDream(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DreamSettingsBody) =>
      api(`/ai/agents/${agentId}/dream`, { method: 'PUT', body, schema: DreamSettings }),
    onSettled: () => void qc.invalidateQueries({ queryKey: dreamKey(agentId) }),
  });
}

export function useDreamChange(agentId: number, id: number) {
  return useQuery({
    queryKey: dreamChangeKey(agentId, id),
    queryFn: ({ signal }) =>
      api(`/ai/agents/${agentId}/dream/changes/${id}`, { signal, schema: DreamChangeDetail }),
  });
}

export type DreamAction = 'apply' | 'dismiss' | 'undo';

/** Apply / Dismiss / Undo (409 `setup_changed`: the text changed since the night, the change is outdated). */
export function useDreamAction(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: DreamAction }) =>
      api(`/ai/agents/${agentId}/dream/changes/${id}/${action}`, {
        method: 'POST',
        schema: DreamChange,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: dreamKey(agentId) });
      // An applied or undone change edits the agent's texts: the page reads them again.
      void qc.invalidateQueries({ queryKey: aiAgentKey(agentId) });
      void qc.invalidateQueries({ queryKey: ['ai-document', agentId] });
    },
  });
}

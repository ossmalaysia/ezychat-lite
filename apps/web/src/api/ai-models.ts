import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AiTaskModelsStatus, type AiTaskModelsBody } from '@ezychat/shared';
import { api } from './client';

/** Settings → AI → AI models (docs/ai-models.md): the current connection's rows. Admins only. */
export const taskModelsKey = ['ai', 'taskModels'] as const;

export function useTaskModels(enabled = true) {
  return useQuery({
    queryKey: taskModelsKey,
    queryFn: () => api('/ai/task-models', { schema: AiTaskModelsStatus }),
    enabled,
  });
}

/** Saves the changed rows (null = back to the default); the current connection only. */
export function useSaveTaskModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiTaskModelsBody) =>
      api('/ai/task-models', { method: 'PUT', body, schema: AiTaskModelsStatus }),
    onSuccess: (next) => qc.setQueryData(taskModelsKey, next),
  });
}

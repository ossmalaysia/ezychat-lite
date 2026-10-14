import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EnrichmentStatus } from '@wa-team-inbox/shared';
import { api } from './client';

const key = ['customer-enrichment'] as const;
export function useEnrichment() {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api('/ai/enrichment', { signal, schema: EnrichmentStatus }),
    refetchInterval: 5000,
  });
}
export function useSaveEnrichment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api('/ai/enrichment', {
        method: 'PUT',
        body: { enabled },
        schema: EnrichmentStatus,
      }),
    onSuccess: (status) => client.setQueryData(key, status),
    onError: () => void client.invalidateQueries({ queryKey: key }),
  });
}

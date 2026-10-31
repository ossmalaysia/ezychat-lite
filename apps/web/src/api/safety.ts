import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SafetyChatState,
  SafetyReport,
  SafetySettings,
  SafetyState,
  type ReportPeriod,
  type SafetyAction,
  type SafetyActionBody,
} from '@ezychat/shared';
import { api } from './client';

/**
 * WhatsApp Safety (docs/features/whatsapp-safety/design.md): Admin → Safety, the chat bar and
 * Admin → Reports → WhatsApp Safety. A message's own finding comes with the message (`safety`).
 */
export const safetyKeys = {
  state: ['safety'] as const,
  chat: (jid: string) => ['safety', 'chat', jid] as const,
  report: (days: ReportPeriod) => ['safety', 'report', days] as const,
};

export function useSafety() {
  return useQuery({
    queryKey: safetyKeys.state,
    queryFn: ({ signal }) => api('/safety', { schema: SafetyState, signal }),
    refetchInterval: 30_000,
  });
}

export function useSafetyChat(jid: string) {
  return useQuery({
    queryKey: safetyKeys.chat(jid),
    queryFn: ({ signal }) =>
      api(`/safety/chats/${encodeURIComponent(jid)}`, { schema: SafetyChatState, signal }),
    refetchInterval: 30_000,
  });
}

export function useSafetyReport(days: ReportPeriod) {
  return useQuery({
    queryKey: safetyKeys.report(days),
    queryFn: ({ signal }) => api(`/reports/safety?days=${days}`, { schema: SafetyReport, signal }),
    staleTime: 60_000,
  });
}

export function useSafetySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SafetySettings>) =>
      api('/safety/settings', { method: 'PUT', body, schema: SafetySettings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: safetyKeys.state }),
  });
}

export function useSafetyAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body = {},
    }: {
      id: number;
      action: SafetyAction;
      body?: SafetyActionBody;
    }) => api(`/safety/items/${id}/${action}`, { method: 'POST', body, schema: SafetyState }),
    onSuccess: (state) => {
      qc.setQueryData(safetyKeys.state, state);
      // The chat bars and the report follow (blocked, reported).
      void qc.invalidateQueries({ queryKey: ['safety'] });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookingSettings,
  CalendarActivityList,
  GoogleCalendarConnectProgress,
  GoogleCalendarConnectStart,
  GoogleCalendarStatus,
} from '@ezychat/shared';
import { api } from './client';

/** Admin → Connectors → Google Calendar (admins only). Tokens never reach the browser. */
export const googleCalendarKey = ['connectors', 'google-calendar'] as const;
export const bookingSettingsKey = (agentId: number) =>
  [...googleCalendarKey, 'agent', agentId] as const;
export const calendarActivityKey = [...googleCalendarKey, 'activity'] as const;

export function useGoogleCalendar(enabled = true) {
  return useQuery({
    queryKey: googleCalendarKey,
    queryFn: ({ signal }) =>
      api('/connectors/google-calendar', { signal, schema: GoogleCalendarStatus }),
    enabled,
  });
}

/** Starts Google's sign-in: the page opens `authorizationUrl` and polls the request. */
export function useGoogleCalendarConnect() {
  return useMutation({
    mutationFn: () =>
      api('/connectors/google-calendar/connect', {
        method: 'POST',
        schema: GoogleCalendarConnectStart,
      }),
  });
}

/** Polls a sign-in every 2 s until Google sent the person back (done) or it failed. */
export function useGoogleCalendarProgress(requestId: string | null) {
  return useQuery({
    queryKey: [...googleCalendarKey, 'connect', requestId] as const,
    queryFn: ({ signal }) =>
      api(`/connectors/google-calendar/connect/${encodeURIComponent(requestId ?? '')}`, {
        signal,
        schema: GoogleCalendarConnectProgress,
      }),
    enabled: requestId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
    gcTime: 0,
  });
}

export function useGoogleCalendarDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/connectors/google-calendar/disconnect', { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: googleCalendarKey }),
  });
}

/** One AI agent's booking settings (the defaults until an admin saves them). */
export function useBookingSettings(agentId: number | null, enabled = true) {
  return useQuery({
    queryKey: bookingSettingsKey(agentId ?? 0),
    queryFn: ({ signal }) =>
      api(`/connectors/google-calendar/agents/${agentId}`, { signal, schema: BookingSettings }),
    enabled: enabled && agentId !== null,
  });
}

export function useSaveBookingSettings(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BookingSettings) =>
      api(`/connectors/google-calendar/agents/${agentId}`, {
        method: 'PUT',
        body,
        schema: BookingSettings,
      }),
    onSuccess: (saved) => qc.setQueryData(bookingSettingsKey(agentId), saved),
  });
}

export function useCalendarActivity(enabled = true) {
  return useQuery({
    queryKey: calendarActivityKey,
    queryFn: ({ signal }) =>
      api('/connectors/google-calendar/activity', { signal, schema: CalendarActivityList }),
    enabled,
  });
}

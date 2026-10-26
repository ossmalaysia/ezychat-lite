import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConnectorActivityList,
  ConnectorAgentSettings,
  ConnectorConnectionView,
  ConnectorConnectProgress,
  ConnectorConnectResult,
  ConnectorGallery,
  ConnectorChoices,
  ConnectorProblem,
  ConnectorTestResult,
  type ConnectorConnectBody,
} from '@ezychat/shared';
import { ApiError, api } from './client';

/**
 * Admin → Connectors from the connector list (design docs/features/connector-list/design.md):
 * the list the server keeps, and partner (MCP) connections. Admins only; keys, tokens and secrets
 * never come back to the browser (only the key end).
 */
export const connectorListKey = ['connectors', 'list'] as const;
const mcpKey = (id: string) => ['connectors', 'mcp', id] as const;
export const connectorAgentKey = (id: string, agentId: number) =>
  [...mcpKey(id), 'agent', agentId] as const;
const connectorActivityKey = (id: string) => [...mcpKey(id), 'activity'] as const;

/** The list as the server keeps it (no download). */
export function useConnectorGallery(enabled = true) {
  return useQuery({
    queryKey: connectorListKey,
    queryFn: ({ signal }) => api('/connectors/list', { signal, schema: ConnectorGallery }),
    enabled,
  });
}

/** Downloads and checks the list now (gallery open, Check for new connectors). */
export function useRefreshConnectorList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/connectors/list/refresh', { method: 'POST', schema: ConnectorGallery }),
    onSuccess: (gallery) => qc.setQueryData(connectorListKey, gallery),
  });
}

/** Puts a partner connection's new state into the cached list. */
function useSetConnection() {
  const qc = useQueryClient();
  return (id: string, connection: ConnectorConnectionView) =>
    qc.setQueryData<ConnectorGallery>(connectorListKey, (gallery) =>
      gallery
        ? {
            ...gallery,
            connectors: gallery.connectors.map((c) =>
              c.entry.id === id ? { ...c, connection } : c,
            ),
          }
        : gallery,
    );
}

/**
 * Connects: OAuth answers with `authorizationUrl` + `requestId` (open it, then poll); the key and
 * form sign-ins send their `fields` and answer with the connection.
 */
export function useConnectorConnect(id: string) {
  const setConnection = useSetConnection();
  return useMutation({
    mutationFn: (body: ConnectorConnectBody) =>
      api(`/connectors/mcp/${id}/connect`, {
        method: 'POST',
        body,
        schema: ConnectorConnectResult,
      }),
    onSuccess: (result) => setConnection(id, result.connection),
  });
}

/** Polls an OAuth sign-in every 2 s until the partner sent the person back or it failed. */
export function useConnectorConnectProgress(id: string, requestId: string | null) {
  return useQuery({
    queryKey: [...mcpKey(id), 'connect', requestId] as const,
    queryFn: ({ signal }) =>
      api(`/connectors/mcp/${id}/connect/${encodeURIComponent(requestId ?? '')}`, {
        signal,
        schema: ConnectorConnectProgress,
      }),
    enabled: requestId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
    gcTime: 0,
  });
}

/** The connector problem an API error carries as its code (refused, unreachable, …), if any. */
export function connectorProblemOf(error: unknown): ConnectorProblem | null {
  if (!(error instanceof ApiError)) return null;
  const parsed = ConnectorProblem.safeParse(error.code);
  return parsed.success ? parsed.data : null;
}

/**
 * Tests the typed fields (before Save) or, with no fields, the saved connection. A failure the
 * server names (`{ error: { code: <problem> } }`) comes back as a result, like `ok: false`.
 */
export function useConnectorTest(id: string) {
  return useMutation({
    mutationFn: async (body: ConnectorConnectBody): Promise<ConnectorTestResult> => {
      try {
        return await api(`/connectors/mcp/${id}/test`, {
          method: 'POST',
          body,
          schema: ConnectorTestResult,
        });
      } catch (error) {
        const problem = connectorProblemOf(error);
        if (problem) return { ok: false, tools: [], problem };
        throw error;
      }
    },
  });
}

export function useConnectorDisconnect(id: string) {
  const qc = useQueryClient();
  const setConnection = useSetConnection();
  return useMutation({
    mutationFn: () =>
      api(`/connectors/mcp/${id}/disconnect`, {
        method: 'POST',
        schema: ConnectorConnectionView,
      }),
    onSuccess: (connection) => setConnection(id, connection),
    onSettled: () => void qc.invalidateQueries({ queryKey: connectorListKey }),
  });
}

/** One AI agent's settings values and tool switches for a partner connector. */
export function useConnectorAgentSettings(id: string, agentId: number, enabled = true) {
  return useQuery({
    queryKey: connectorAgentKey(id, agentId),
    queryFn: ({ signal }) =>
      api(`/connectors/mcp/${id}/agents/${agentId}`, { signal, schema: ConnectorAgentSettings }),
    enabled,
  });
}

/** The same for several connectors at once (the agent page's Connectors card). */
export function useConnectorsAgentSettings(ids: readonly string[], agentId: number) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: connectorAgentKey(id, agentId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api(`/connectors/mcp/${id}/agents/${agentId}`, {
          signal,
          schema: ConnectorAgentSettings,
        }),
    })),
  });
}

export function useSaveConnectorAgentSettings(id: string, agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConnectorAgentSettings) =>
      api(`/connectors/mcp/${id}/agents/${agentId}`, {
        method: 'PUT',
        body,
        schema: ConnectorAgentSettings,
      }),
    onSuccess: (saved) => qc.setQueryData(connectorAgentKey(id, agentId), saved),
  });
}

/** What the AI looked up and did through the connector (never chat text). */
export function useConnectorActivity(id: string, enabled = true) {
  return useQuery({
    queryKey: connectorActivityKey(id),
    queryFn: ({ signal }) =>
      api(`/connectors/mcp/${id}/activity`, { signal, schema: ConnectorActivityList }),
    enabled,
  });
}

/** The choices of a picker setting, read from the partner through its look-up tool. */
export function useConnectorChoices(
  id: string,
  settingId: string,
  agentId: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...mcpKey(id), 'choices', settingId, agentId] as const,
    queryFn: ({ signal }) =>
      api(`/connectors/mcp/${id}/choices/${settingId}?agentId=${agentId}`, {
        signal,
        schema: ConnectorChoices,
      }),
    enabled,
  });
}

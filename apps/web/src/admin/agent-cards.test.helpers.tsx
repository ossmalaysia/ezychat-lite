import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AiAgentGroups } from '@ezychat/shared';

/** Shared by the agent page card tests (Groups, Direct chats). */
export const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

/** `GET /api/ai/agents/:agentId/groups` as the server answers it, with `patch` on top. */
export const agentGroupsData = (patch: Partial<AiAgentGroups> = {}): AiAgentGroups => ({
  enabled: true,
  groups: [],
  loopGuard: 10,
  inboxName: null,
  answerDirect: true,
  directAvailable: true,
  heldDirect: 0,
  ...patch,
});

/** Renders `ui` with a fresh query client (no retries). */
export function renderWithQuery(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

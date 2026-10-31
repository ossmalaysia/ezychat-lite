import type { ReactElement } from 'react';
import { vi } from 'vitest';
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

export type Call = { url: string; method: string; body: unknown };

/**
 * Replaces `fetch` with a stand-in server: `answer` gets each request (JSON body parsed) and returns
 * the response, or undefined for 404. Returns the list of calls made.
 */
export function stubFetch(
  answer: (url: string, method: string, body: unknown) => Response | undefined,
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      return (
        answer(url, method, body) ??
        json({ error: { code: 'not_found', message: 'Not found' } }, 404)
      );
    }),
  );
  return calls;
}

import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AiMemberStatus } from '@ezychat/shared';
import { useAiMember } from './ai';
import { taskModelsKey } from './ai-models';

const status = (state: AiMemberStatus['connection']['state']): AiMemberStatus => ({
  member: null,
  settings: { displayName: 'Sales', enabled: false, mode: 'chatgpt', model: '', instructions: '' },
  hasApiKey: false,
  hasClaudeApiKey: false,
  connection: { state, loginUrl: null, error: null },
  documents: [],
  agents: [],
  maxAgents: 1,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('reloads AI models when a ChatGPT sign-in finishes while polling, not on every poll', async () => {
  const answers = [status('signing_in'), status('signing_in'), status('connected')];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(answers.shift() ?? status('connected')), {
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAiMember(), { wrapper });
  await waitFor(() => expect(result.current.data?.connection.state).toBe('signing_in'));
  expect(invalidate).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.data?.connection.state).toBe('connected'), {
    timeout: 6000,
  });
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: taskModelsKey });
});

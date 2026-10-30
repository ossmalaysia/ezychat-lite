import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentResolutionCard } from './AgentResolutionCard';

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

const status = (resolutionCheck: boolean) => ({
  agent: {
    id: 3,
    userId: 9,
    displayName: 'Mei',
    enabled: true,
    preset: 'sales',
    inboxId: 1,
    documentCount: 1,
    resolutionCheck,
  },
  settings: { displayName: 'Mei', enabled: true, mode: 'api', model: '', instructions: '' },
  documents: [],
});

function renderCard(enabled: boolean, fail = false) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method ?? 'GET', body });
      if (fail) return json({ error: { code: 'internal', message: 'Boom' } }, 500);
      return json(status((body as { enabled: boolean }).enabled));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AgentResolutionCard agentId={3} name="Mei" enabled={enabled} />
    </QueryClientProvider>,
  );
  return { calls, qc };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentResolutionCard', () => {
  it('explains the off state (sales default): no check-in line, the team closes chats', () => {
    renderCard(false);
    expect(
      screen
        .getByRole('switch', { name: 'Ask if the question is answered' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByText(
        'Mei adds no check-in line and never closes a chat. Your team closes chats.',
      ),
    ).toBeTruthy();
  });

  it('saves the switch at once and caches the saved agent', async () => {
    const { calls, qc } = renderCard(false);
    await userEvent.click(screen.getByRole('switch', { name: 'Ask if the question is answered' }));
    await waitFor(() =>
      expect(calls).toEqual([
        { url: '/api/ai/agents/3/resolution-check', method: 'PUT', body: { enabled: true } },
      ]),
    );
    await waitFor(() =>
      expect(
        qc.getQueryData<{ agent: { resolutionCheck: boolean } }>(['ai-agent', 3])?.agent
          .resolutionCheck,
      ).toBe(true),
    );
  });

  it('shows the on hint', () => {
    renderCard(true);
    expect(
      screen
        .getByRole('switch', { name: 'Ask if the question is answered' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByText(/closes the chat when the customer clearly says yes/)).toBeTruthy();
  });
});

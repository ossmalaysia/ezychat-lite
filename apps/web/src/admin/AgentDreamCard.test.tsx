import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DreamChange, DreamHistory } from '@ezychat/shared';
import { AgentDreamCard } from './AgentDreamCard';

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

const change = (over: Partial<DreamChange> = {}): DreamChange => ({
  id: 11,
  runId: 1,
  target: 'context_text',
  itemId: 7,
  itemName: 'Opening hours',
  summary: 'Saturday: 9 am to 1 pm',
  status: 'waiting',
  auto: false,
  sourceCount: 2,
  createdAt: Date.UTC(2026, 10, 13, 18, 0),
  decidedAt: null,
  ...over,
});

const history = (
  over: Partial<DreamHistory> = {},
  changes: DreamChange[] = [change()],
): DreamHistory => ({
  settings: { enabled: true, runTime: '02:00', autoApply: false },
  aiReady: true,
  nextBefore: null,
  runs: [
    {
      id: 1,
      slot: Date.UTC(2026, 10, 13, 18, 0),
      status: 'done',
      reason: null,
      chatsRead: 38,
      takeovers: 4,
      saved: changes.length,
      dropped: 1,
      changes,
    },
  ],
  ...over,
});

function renderCard(data: DreamHistory) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith('/dream') && method === 'PUT')
        return json({ ...data.settings, ...(body as object) });
      if (url.endsWith('/dream')) return json(data);
      if (/\/changes\/\d+$/.test(url))
        return json({
          ...data.runs[0]!.changes[0],
          before: 'Closed on weekends.',
          after: 'Saturday: 9 am to 1 pm.',
          checks: [
            { name: 'replay', ok: true },
            { name: 'privacy', ok: true },
          ],
          sources: [
            { role: 'customer', name: null, at: 1, text: 'Are you open this Saturday?' },
            { role: 'team', name: 'Jazz', at: 2, text: 'Yes, Saturday we open 9 am to 1 pm.' },
          ],
        });
      const action = url.match(/\/(apply|dismiss|undo)$/)?.[1];
      const status = { apply: 'applied', dismiss: 'dismissed', undo: 'undone' }[action ?? 'apply'];
      return json({ ...data.runs[0]!.changes[0], status });
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AgentDreamCard agentId={3} name="Sales Agent" />
    </QueryClientProvider>,
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentDreamCard', () => {
  it('turns dream mode on', async () => {
    const calls = renderCard(
      history({ settings: { enabled: false, runTime: '02:00', autoApply: false }, runs: [] }),
    );
    await userEvent.click(await screen.findByRole('switch', { name: 'Dream mode' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ enabled: true });
  });

  it('applies a waiting change from the history', async () => {
    const calls = renderCard(history());
    const row = (await screen.findByText('Saturday: 9 am to 1 pm')).closest(
      '[data-testid="dream-change"]',
    ) as HTMLElement;
    expect(within(row).getByText('Waiting for you')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Undo' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/changes/11/apply'))).toBe(true));
  });

  it('offers Undo only on an applied change', async () => {
    const calls = renderCard(history({}, [change({ status: 'applied', auto: true })]));
    const row = (await screen.findByText('Saturday: 9 am to 1 pm')).closest(
      '[data-testid="dream-change"]',
    ) as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Apply' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/changes/11/undo'))).toBe(true));
  });

  it('says dream mode is paused while the AI is not connected', async () => {
    renderCard(history({ aiReady: false }));
    expect(await screen.findByText(/Paused: the AI is not connected/)).toBeTruthy();
  });

  it('shows an outdated change without Apply', async () => {
    renderCard(history({}, [change({ status: 'stale' })]));
    const row = (await screen.findByText('Saturday: 9 am to 1 pm')).closest(
      '[data-testid="dream-change"]',
    ) as HTMLElement;
    expect(within(row).getByText('Outdated')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('opens See change with the before and after, the team reply and the checks', async () => {
    renderCard(history());
    await userEvent.click(await screen.findByRole('button', { name: 'See change' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Closed on weekends.')).toBeTruthy();
    expect(within(dialog).getByText('Saturday: 9 am to 1 pm.')).toBeTruthy();
    expect(within(dialog).getByText('Yes, Saturday we open 9 am to 1 pm.')).toBeTruthy();
    expect(within(dialog).getByText(/Jazz/)).toBeTruthy();
    expect(within(dialog).getAllByText(/✓/).length).toBe(2);
  });
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReplySuggestionsSection } from './ReplySuggestionsSection';

type Status = { enabled: boolean; connected: boolean; state: string; upgraded: boolean };
let client: QueryClient;
let status: Status;
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    expect(url).toBe('/api/ai/reply-suggestions');
    const { enabled } = JSON.parse(String(init.body)) as { enabled: boolean };
    status = { ...status, enabled, state: enabled && status.connected ? 'on' : 'off' };
  } else expect(url).toBe('/api/reply-suggestions');
  return json(status);
});
beforeEach(() => {
  status = { enabled: true, connected: true, state: 'on', upgraded: false };
  fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
const setup = () =>
  render(
    <QueryClientProvider client={client}>
      <ReplySuggestionsSection />
    </QueryClientProvider>,
  );

it('turns the team-wide switch off only on Save', async () => {
  setup();
  const user = userEvent.setup();
  const toggle = await screen.findByRole('switch', { name: 'Suggest replies for the team' });
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect(screen.getByText(/one request to your AI provider/)).toBeTruthy();
  await user.click(toggle);
  expect(fetcher.mock.calls.filter((c) => c[1]?.method === 'PUT')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(status.enabled).toBe(false));
});

it('disables the switch with a hint when no AI is connected', async () => {
  status = { enabled: true, connected: false, state: 'off', upgraded: false };
  setup();
  expect(
    await screen.findByText('Connect an AI provider above to use reply suggestions.'),
  ).toBeTruthy();
  const toggle = screen.getByRole('switch', { name: 'Suggest replies for the team' });
  expect(toggle.hasAttribute('disabled')).toBe(true);
});

it('shows the note after an update, while the switch is still off', async () => {
  status = { enabled: false, connected: true, state: 'off', upgraded: true };
  setup();
  expect(await screen.findByText(/New: reply suggestions/)).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole('switch', { name: 'Suggest replies for the team' }));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(screen.queryByText(/New: reply suggestions/)).toBeNull());
});

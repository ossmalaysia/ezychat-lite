import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
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
let model: string;
const MODELS = ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.5'];
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/ai/reply-suggestions/model')
    return json({
      model,
      fastModel: 'gpt-6-luna',
      agentModel: 'gpt-6.1-sol',
      models: MODELS,
      resolved: model === 'fast' ? 'gpt-6-luna' : 'gpt-6.1-sol',
    });
  if (init?.method === 'PUT') {
    expect(url).toBe('/api/ai/reply-suggestions');
    const body = JSON.parse(String(init.body)) as { enabled?: boolean; model?: string };
    if (body.enabled !== undefined)
      status = {
        ...status,
        enabled: body.enabled,
        state: body.enabled && status.connected ? 'on' : 'off',
      };
    if (body.model !== undefined) model = body.model;
  } else expect(url).toBe('/api/reply-suggestions');
  return json(status);
});
beforeAll(() => {
  // Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
beforeEach(() => {
  status = { enabled: true, connected: true, state: 'on', upgraded: false };
  model = 'fast';
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

it('saves the model for suggestions; the hint warns that a larger model is slower', async () => {
  setup();
  const user = userEvent.setup();
  const picker = await screen.findByRole('combobox', { name: 'Model for suggestions' });
  expect(picker.textContent).toContain('Fast (recommended): gpt-6-luna');
  expect(screen.getByText(/gpt-6-luna is the fast model of this connection/)).toBeTruthy();
  await user.click(picker);
  await user.click(
    await screen.findByRole('option', { name: 'Same as the AI connection: gpt-6.1-sol' }),
  );
  expect(screen.getByText(/A larger model writes slower/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(model).toBe('agent'));
  const put = fetcher.mock.calls.find((c) => c[1]?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]!.body))).toEqual({ model: 'agent' });
});

it('shows Fast for a saved model the connection no longer lists', async () => {
  model = 'claude-opus-5-5';
  setup();
  const picker = await screen.findByRole('combobox', { name: 'Model for suggestions' });
  expect(picker.textContent).toContain('Fast (recommended)');
});

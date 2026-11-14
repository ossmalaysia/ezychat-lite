import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AskEzySettingsSection } from './AskEzySettingsSection';

let client: QueryClient;
let minutes: number;
let failPut: boolean;
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  expect(url).toBe('/api/ask-ezy/settings');
  if (init?.method === 'PUT') {
    if (failPut) return json({ error: { code: 'bad_request', message: 'Invalid value' } }, 400);
    minutes = (JSON.parse(String(init.body)) as { timeoutMinutes: number }).timeoutMinutes;
  }
  return json({ timeoutMinutes: minutes });
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
  minutes = 15;
  failPut = false;
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
      <AskEzySettingsSection />
    </QueryClientProvider>,
  );
const puts = () => fetcher.mock.calls.filter((c) => c[1]?.method === 'PUT');

it('shows the saved limit (15 minutes by default) and saves a new one only on Save', async () => {
  setup();
  const user = userEvent.setup();
  const select = await screen.findByTestId('ask-ezy-timeout');
  await waitFor(() => expect(select.textContent).toBe('15 minutes (default)'));
  expect(screen.getByText(/Anyone can press Stop at any time/)).toBeTruthy();
  await user.click(select);
  await user.click(await screen.findByRole('option', { name: '30 minutes' }));
  expect(puts()).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({ timeoutMinutes: 30 });
  await waitFor(() => expect(select.textContent).toBe('30 minutes'));
});

it('shows a failed save', async () => {
  failPut = true;
  setup();
  const user = userEvent.setup();
  const select = await screen.findByTestId('ask-ezy-timeout');
  await waitFor(() => expect(select.textContent).toBe('15 minutes (default)'));
  await user.click(select);
  await user.click(await screen.findByRole('option', { name: '5 minutes' }));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByText('Invalid value')).toBeTruthy();
});

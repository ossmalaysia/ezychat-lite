import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerEnrichmentSection } from './CustomerEnrichmentSection';

let client: QueryClient;
let status = { enabled: false, connected: false };
let fail = false;
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    if (fail) return json({ error: { code: 'conflict', message: 'Save failed' } }, 409);
    status = { ...status, ...JSON.parse(String(init.body)) };
  }
  return json(status);
});
beforeEach(() => {
  status = { enabled: false, connected: false };
  fail = false;
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
function setup() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CustomerEnrichmentSection />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it('keeps draft edits through a refresh and saves only on Save', async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole('switch', { name: 'Automatically update customer details' });
  await user.click(screen.getByRole('switch'));
  expect(fetcher.mock.calls.filter((c) => c[1]?.method === 'PUT')).toHaveLength(0);
  await client.invalidateQueries();
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  expect(
    screen.getByText('Enrichment is paused until the AI connection is restored.'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(status.enabled).toBe(true));
  expect(screen.getByRole('link', { name: 'View audit' }).getAttribute('href')).toBe(
    '/admin/audit',
  );
});
it('retains the draft and displays the error when saving fails', async () => {
  fail = true;
  setup();
  const user = userEvent.setup();
  await screen.findByRole('switch');
  await user.click(screen.getByRole('switch'));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Save failed');
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  expect(status.enabled).toBe(false);
});

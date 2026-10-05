import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DevBuildBadge } from './DevBuildBadge';

function renderWithServerMode(mode: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ app: 'wa-team-inbox', version: '0.1.20', mode }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DevBuildBadge />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.title = '';
});

it('marks a dev or test server with a Dev Build badge and tab title', async () => {
  document.title = 'EzyChat Lite';
  renderWithServerMode('dev');
  expect(await screen.findByText('Dev Build')).toBeTruthy();
  await waitFor(() => expect(document.title).toBe('[Dev Build] EzyChat Lite'));
});

it('shows nothing for a production server', async () => {
  document.title = 'EzyChat Lite';
  renderWithServerMode('service');
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByText('Dev Build')).toBeNull();
  expect(document.title).toBe('EzyChat Lite');
});

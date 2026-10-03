import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CloudflareSetupStatus } from '@wa-team-inbox/shared';
import type * as ApiClient from '../api/client';
import { api } from '../api/client';
import { CloudflareSetup } from './CloudflareSetup';

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  api: vi.fn(),
}));

const exampleDomain = { id: 'a'.repeat(32), name: 'example.com', accountName: 'Example team' };
const otherDomain = { id: 'b'.repeat(32), name: 'example.org', accountName: null };
let current: CloudflareSetupStatus;
let client: QueryClient;
const mockApi = vi.mocked(api);
const running = {
  mode: 'named',
  state: 'starting',
  url: null,
  hostname: 'inbox.example.com',
  lastError: null,
  logTail: [],
};

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  current = {
    state: 'signed_out',
    loginUrl: null,
    error: null,
    domains: [],
    busy: false,
    managed: null,
  };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  mockApi.mockReset();
  mockApi.mockImplementation(async (path) => {
    if (path === '/tunnel/cloudflare') return current;
    if (path === '/tunnel/cloudflare/login') {
      current = {
        ...current,
        state: 'awaiting_approval',
        loginUrl: 'https://dash.cloudflare.com/argotunnel?aud=test',
      };
      return current;
    }
    if (path === '/tunnel/cloudflare/login/cancel') {
      current = { ...current, state: 'signed_out', loginUrl: null };
      return current;
    }
    if (path === '/tunnel/cloudflare/refresh') return current;
    if (path === '/tunnel/cloudflare/create') return running;
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <CloudflareSetup />
    </QueryClientProvider>,
  );
}

function connect(domains: CloudflareSetupStatus['domains'] = [exampleDomain]) {
  current = { ...current, state: 'connected', domains };
}

it('starts sign-in only on request, exposes the approval page, and can cancel', async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByRole('button', { name: 'Sign in to Cloudflare' });
  expect(mockApi.mock.calls.every(([path]) => path === '/tunnel/cloudflare')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Sign in to Cloudflare' }));
  const link = await screen.findByRole('link', { name: /Open Cloudflare sign-in/ });
  expect(link.getAttribute('href')).toBe('https://dash.cloudflare.com/argotunnel?aud=test');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(screen.queryByRole('button', { name: 'Create and connect inbox' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
  await screen.findByRole('button', { name: 'Sign in to Cloudflare' });
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/login/cancel'))).toBe(true);
});

it('polls pending approval and stops automatic polling once connected', async () => {
  vi.useFakeTimers();
  current = {
    ...current,
    state: 'awaiting_approval',
    loginUrl: 'https://dash.cloudflare.com/argotunnel?aud=test',
  };
  mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  connect();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(screen.getByText('Cloudflare account connected.')).toBeTruthy();
  const requestCount = mockApi.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mockApi.mock.calls.length).toBe(requestCount);
});

it('lets the user choose an approved domain and creates only after explicit publication', async () => {
  const user = userEvent.setup();
  connect([exampleDomain, otherDomain]);
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  mount();
  await screen.findByRole('button', { name: 'Create and connect inbox' });
  expect(screen.getByLabelText('Inbox address preview').textContent).toBe(
    'https://inbox.example.com',
  );
  expect(mockApi.mock.calls.every(([path]) => path === '/tunnel/cloudflare')).toBe(true);
  await user.click(screen.getByRole('combobox', { name: 'Domain' }));
  await user.click(screen.getByRole('option', { name: 'example.org' }));
  await user.clear(screen.getByRole('textbox', { name: 'Address prefix' }));
  await user.type(screen.getByRole('textbox', { name: 'Address prefix' }), 'Support');
  expect(screen.getByLabelText('Inbox address preview').textContent).toBe(
    'https://support.example.org',
  );
  await user.click(screen.getByRole('button', { name: 'Create and connect inbox' }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      '/tunnel/cloudflare/create',
      expect.objectContaining({
        body: { domainId: otherDomain.id, subdomain: 'support', tunnelName: 'wa-team-inbox' },
      }),
    ),
  );
  await screen.findByText('Cloudflare connection saved');
  expect(invalidation).toHaveBeenCalledWith({ queryKey: ['tunnel'] });
  expect(invalidation).toHaveBeenCalledWith({ queryKey: ['settings'] });
  expect(invalidation).toHaveBeenCalledWith({ queryKey: ['cloudflare-setup'] });
});

it('validates the address before contacting Cloudflare', async () => {
  connect();
  const user = userEvent.setup();
  mount();
  const prefix = await screen.findByRole('textbox', { name: 'Address prefix' });
  await user.clear(prefix);
  await user.type(prefix, '-bad');
  await user.click(screen.getByRole('button', { name: 'Create and connect inbox' }));
  expect(screen.getByRole('alert').textContent).toContain('without a hyphen at either end');
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/create'))).toBe(false);
});

it('preserves the form on failure and only retries creation after another click', async () => {
  connect();
  const original = mockApi.getMockImplementation()!;
  let attempts = 0;
  mockApi.mockImplementation(async (...args) => {
    if (args[0].endsWith('/create') && attempts++ === 0)
      throw new Error('That inbox address is already in use. Choose another.');
    return original(...args);
  });
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: 'Create and connect inbox' }));
  await screen.findByText('That inbox address is already in use. Choose another.');
  expect((screen.getByRole('textbox', { name: 'Address prefix' }) as HTMLInputElement).value).toBe(
    'inbox',
  );
  expect(attempts).toBe(1);
  await user.click(screen.getByRole('button', { name: 'Create and connect inbox' }));
  await screen.findByText('Cloudflare connection saved');
  expect(attempts).toBe(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('handles an empty domain list and refreshes authorized domains', async () => {
  connect([]);
  mount();
  await screen.findByText('No approved domain found');
  expect(screen.queryByRole('button', { name: 'Create and connect inbox' })).toBeNull();
  connect();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh domains' }));
  await screen.findByRole('button', { name: 'Create and connect inbox' });
});

it('prefills an app-managed address and starts fresh approval for another domain', async () => {
  connect();
  current.managed = {
    id: '00000000-0000-4000-8000-000000000000',
    name: 'Sales team inbox',
    hostname: 'sales.example.com',
  };
  mount();
  await screen.findByRole('textbox', { name: 'Address prefix' });
  expect((screen.getByRole('textbox', { name: 'Address prefix' }) as HTMLInputElement).value).toBe(
    'sales',
  );
  expect((screen.getByRole('textbox', { name: 'Tunnel name' }) as HTMLInputElement).value).toBe(
    'Sales team inbox',
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Choose another domain' }));
  await screen.findByRole('link', { name: /Open Cloudflare sign-in/ });
  expect(screen.queryByRole('button', { name: 'Create and connect inbox' })).toBeNull();
});

it('does not render a sign-in link for an unexpected URL and supports cancelling', async () => {
  current = { ...current, state: 'awaiting_approval', loginUrl: 'https://untrusted.example/login' };
  mount();
  await screen.findByRole('button', { name: 'Cancel sign-in' });
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('sign-in address could not be verified');
});

it('shows a retry action for a failed status request', async () => {
  mockApi.mockRejectedValueOnce(new Error('Cannot reach the server. Check your connection.'));
  mount();
  await screen.findByText('Cannot reach the server. Check your connection.');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: 'Sign in to Cloudflare' });
});

it('keeps pending approval available after cancellation fails and allows retry', async () => {
  const user = userEvent.setup();
  current = {
    ...current,
    state: 'awaiting_approval',
    loginUrl: 'https://dash.cloudflare.com/argotunnel?aud=test',
  };
  const original = mockApi.getMockImplementation()!;
  let cancellations = 0;
  mockApi.mockImplementation(async (...args) => {
    if (args[0].endsWith('/login/cancel') && cancellations++ === 0)
      throw new Error('Cannot cancel sign-in right now. Try again.');
    return original(...args);
  });
  mount();
  await user.click(await screen.findByRole('button', { name: 'Cancel sign-in' }));
  await screen.findByText('Cannot cancel sign-in right now. Try again.');
  expect(screen.getByRole('link', { name: /Open Cloudflare sign-in/ })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
  await screen.findByRole('button', { name: 'Sign in to Cloudflare' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(cancellations).toBe(2);
});

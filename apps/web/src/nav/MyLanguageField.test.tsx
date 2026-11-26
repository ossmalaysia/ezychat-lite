import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyLanguageField } from './MyLanguageField';

const auth = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: auth.user }) }));

let enabled: boolean;
const patches: unknown[] = [];
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PATCH') {
    expect(url).toBe('/api/me');
    patches.push(JSON.parse(String(init.body)));
    return json({});
  }
  expect(url).toBe('/api/live-translate');
  return json({ enabled, dailyLimit: 200, connected: true, usedToday: 0 });
});

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
beforeEach(() => {
  enabled = true;
  patches.length = 0;
  auth.user = { id: 1, translateLanguage: null, sendWithoutPreview: false };
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MyLanguageField />
    </QueryClientProvider>,
  );

it('says My language follows the app until a language is picked', async () => {
  setup();
  expect(await screen.findByText(/Same as the app \(English\)/)).toBeTruthy();
});

it('does not say that once a language is chosen', async () => {
  auth.user = { id: 1, translateLanguage: 'ta', sendWithoutPreview: false };
  setup();
  await screen.findByTestId('my-language');
  expect(screen.queryByText(/Same as the app/)).toBeNull();
  expect(screen.getByRole('combobox').textContent).toBe('தமிழ்');
});

it('saves a language to the account', async () => {
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: '中文' }));
  await waitFor(() => expect(patches).toEqual([{ translateLanguage: 'zh' }]));
});

it('turns Send without preview on, off by default', async () => {
  setup();
  const toggle = await screen.findByTestId('send-without-preview');
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await userEvent.click(toggle);
  await waitFor(() => expect(patches).toEqual([{ sendWithoutPreview: true }]));
});

it('is hidden while an admin has Live translate off', async () => {
  enabled = false;
  setup();
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByTestId('my-language')).toBeNull();
});

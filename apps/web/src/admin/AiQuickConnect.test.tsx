import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AiMemberStatus } from '@wa-team-inbox/shared';
import { AiQuickConnect } from './AiQuickConnect';
import '../i18n';

const LOGIN_URL = 'https://auth.openai.com/oauth/authorize?state=abc';

function status(overrides: Partial<AiMemberStatus> = {}): AiMemberStatus {
  return {
    member: null,
    settings: {
      displayName: 'Sales Assistant',
      enabled: false,
      mode: 'api',
      model: '',
      instructions: '',
    },
    hasApiKey: false,
    connection: { state: 'signed_out', loginUrl: null, error: null },
    documents: [],
    ...overrides,
  };
}
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}

/** Renders the block for `initial`; `/api/ai` mutations update `current` like the server would. */
function setup(
  initial: AiMemberStatus,
  keyVerdict: { ok: boolean; error: string | null } = { ok: true, error: null },
) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/ai/connection/test' && init?.method === 'POST') return json(keyVerdict);
    if (url === '/api/ai/connection' && init?.method === 'PATCH') {
      const { apiKey, ...settings } = JSON.parse(String(init.body)) as {
        apiKey?: string;
        mode: 'api' | 'chatgpt';
        model: string;
      };
      current = {
        ...current,
        settings: { ...current.settings, ...settings },
        hasApiKey: current.hasApiKey || Boolean(apiKey),
      };
      return json(current);
    }
    if (url === '/api/ai/chatgpt/login' && init?.method === 'POST') {
      current = {
        ...current,
        connection: { state: 'signing_in', loginUrl: LOGIN_URL, error: null },
      };
      return json(current);
    }
    if (url === '/api/ai') return json(current);
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={qc}>
      <AiQuickConnect status={initial} />
    </QueryClientProvider>,
  );
  /** The parent re-renders with the latest status (the page reads it from the query). */
  const refresh = () =>
    view.rerender(
      <QueryClientProvider client={qc}>
        <AiQuickConnect status={current} />
      </QueryClientProvider>,
    );
  return { fetchMock, refresh };
}
const calls = (fetchMock: ReturnType<typeof vi.fn>, url: string) =>
  fetchMock.mock.calls.filter((call) => call[0] === url);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AiQuickConnect', () => {
  it('offers Sign in with ChatGPT first, marked recommended, with the honest note', () => {
    setup(status());
    const button = screen.getByRole('button', { name: 'Sign in with ChatGPT' });
    expect(screen.getByText('Recommended')).toBeTruthy();
    const note = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(note?.textContent).toMatch(/unofficial and could stop working/);
    expect(screen.queryByLabelText('OpenAI API key')).toBeNull();
  });

  it('signs in with ChatGPT: saves ChatGPT mode, starts sign-in and opens the official page', async () => {
    const tab = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => tab),
    );
    const { fetchMock, refresh } = setup(status());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));
    await waitFor(() => expect(tab.location.href).toBe(LOGIN_URL));
    expect(tab.opener).toBeNull();
    const patch = calls(fetchMock, '/api/ai/connection')[0]!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ mode: 'chatgpt', model: '' });
    expect(calls(fetchMock, '/api/ai/chatgpt/login')).toHaveLength(1);
    refresh();
    expect(await screen.findByText('Signing in… finish in the ChatGPT window.')).toBeTruthy();
    expect(screen.getByLabelText('Signing in on another computer?')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open sign-in' }).getAttribute('href')).toBe(LOGIN_URL);
  });

  it('does not save the mode again when ChatGPT is already chosen', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    const initial = status();
    initial.settings.mode = 'chatgpt';
    const { fetchMock } = setup(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));
    await waitFor(() => expect(calls(fetchMock, '/api/ai/chatgpt/login')).toHaveLength(1));
    expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(0);
  });

  it('tests a working API key and then saves it', async () => {
    const { fetchMock, refresh } = setup(status());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use an OpenAI API key instead' }));
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-good-key-123');
    await user.click(screen.getByRole('button', { name: 'Test key' }));
    await waitFor(() => expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(1));
    const test = calls(fetchMock, '/api/ai/connection/test')[0]!;
    expect(JSON.parse(String(test[1]!.body))).toEqual({ apiKey: 'sk-good-key-123' });
    const patch = calls(fetchMock, '/api/ai/connection')[0]!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({
      mode: 'api',
      model: '',
      apiKey: 'sk-good-key-123',
    });
    refresh();
    expect(await screen.findByText('OpenAI API key checked and saved')).toBeTruthy();
  });

  it.each([
    ['invalid_key', 'OpenAI did not accept this key. Check that you copied all of it.'],
    [
      'unreachable',
      'Could not reach OpenAI to check the key. Check the internet connection and try again.',
    ],
    [
      'rate_limited',
      'OpenAI is busy or this key has reached its limit. Wait a minute and try again.',
    ],
  ])('never saves a key whose test fails (%s)', async (error, message) => {
    const { fetchMock } = setup(status(), { ok: false, error });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use an OpenAI API key instead' }));
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-wrong-key{Enter}');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(0);
  });

  it('shows the connected state with the ChatGPT account', () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = { state: 'connected', loginUrl: null, error: null, email: 'o@shop.my' };
    setup(initial);
    expect(screen.getByText('Connected to ChatGPT')).toBeTruthy();
    expect(screen.getByText('Signed in as o@shop.my')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with ChatGPT' })).toBeNull();
  });
});

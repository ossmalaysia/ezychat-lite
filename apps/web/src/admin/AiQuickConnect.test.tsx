import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AiMemberStatus } from '@ezychat/shared';
import { AiQuickConnect, keyTestMessage } from './AiQuickConnect';
import { i18n } from '../i18n';

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
    hasClaudeApiKey: false,
    connection: { state: 'signed_out', loginUrl: null, error: null },
    documents: [],
    agents: [],
    maxAgents: 1,
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
        mode: 'api' | 'chatgpt' | 'claude';
        model: string;
      };
      const claude = settings.mode === 'claude';
      const hasClaudeApiKey = current.hasClaudeApiKey || (claude && Boolean(apiKey));
      current = {
        ...current,
        settings: { ...current.settings, ...settings },
        hasApiKey: current.hasApiKey || (settings.mode === 'api' && Boolean(apiKey)),
        hasClaudeApiKey,
        // Like the server: an API-key mode reports "connected" once its key is saved.
        ...(claude && hasClaudeApiKey
          ? { connection: { state: 'connected', loginUrl: null, error: null } }
          : {}),
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

  it('refuses a key OpenAI rejects, with no Save anyway, and moves focus back to the key', async () => {
    const { fetchMock } = setup(status(), { ok: false, error: 'invalid_key' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use an OpenAI API key instead' }));
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-wrong-key');
    await user.click(screen.getByRole('button', { name: 'Test key' }));
    expect(
      await screen.findByText('OpenAI did not accept this key. Check that you copied all of it.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save anyway' })).toBeNull();
    expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(0);
    // Screen readers read the error through the focused field's description.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('OpenAI API key')),
    );
  });

  it.each([
    ['forbidden', /OpenAI did not let this key list models/],
    ['unreachable', /Could not reach OpenAI to check the key/],
    ['rate_limited', /OpenAI is busy or this key has reached its limit/],
  ])('lets the admin save anyway after a %s test', async (error, message) => {
    const { fetchMock } = setup(status(), { ok: false, error });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use an OpenAI API key instead' }));
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-restricted-key{Enter}');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, '/api/ai/connection')[0]![1]!.body))).toEqual({
      mode: 'api',
      model: '',
      apiKey: 'sk-restricted-key',
    });
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

  it('offers a Claude API key: tests it with Anthropic and saves the Claude connection', async () => {
    const { fetchMock, refresh } = setup(status());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    expect(screen.queryByLabelText('OpenAI API key')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Get a key at console.anthropic.com' }).getAttribute('href'),
    ).toBe('https://console.anthropic.com/settings/keys');
    expect(screen.getByText(/Voice notes use the on-device model with Claude/)).toBeTruthy();
    await user.type(screen.getByLabelText('Anthropic API key'), 'sk-ant-good-key{Enter}');
    await waitFor(() => expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(1));
    const test = calls(fetchMock, '/api/ai/connection/test')[0]!;
    expect(JSON.parse(String(test[1]!.body))).toEqual({
      apiKey: 'sk-ant-good-key',
      mode: 'claude',
    });
    expect(JSON.parse(String(calls(fetchMock, '/api/ai/connection')[0]![1]!.body))).toEqual({
      mode: 'claude',
      model: '',
      apiKey: 'sk-ant-good-key',
    });
    refresh();
    expect(await screen.findByText('Claude API key checked and saved')).toBeTruthy();
  });

  it('keeps the saved Claude model when a new Claude key is saved', async () => {
    const initial = status();
    initial.settings = { ...initial.settings, mode: 'claude', model: 'claude-opus-5-5' };
    const { fetchMock } = setup(initial);
    const user = userEvent.setup();
    // A saved Claude connection that is not ready opens on the Claude key.
    await user.type(screen.getByLabelText('Anthropic API key'), 'sk-ant-new-key');
    await user.click(screen.getByRole('button', { name: 'Test key' }));
    await waitFor(() => expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, '/api/ai/connection')[0]![1]!.body))).toEqual({
      mode: 'claude',
      model: 'claude-opus-5-5',
      apiKey: 'sk-ant-new-key',
    });
  });

  it('points a key of the other vendor to the right option without testing it', async () => {
    const { fetchMock } = setup(status());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    await user.type(screen.getByLabelText('Anthropic API key'), 'sk-proj-openai{Enter}');
    expect(await screen.findByText(/This is an OpenAI key/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save anyway' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Use an OpenAI API key instead' }));
    expect(screen.queryByText(/This is an OpenAI key/)).toBeNull();
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-ant-claude{Enter}');
    expect(await screen.findByText(/This is a Claude \(Anthropic\) key/)).toBeTruthy();
    expect(calls(fetchMock, '/api/ai/connection/test')).toHaveLength(0);
    expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(0);
  });

  it('names Anthropic when it rejects a key, and saves anyway after an unreachable check', async () => {
    const rejected = setup(status(), { ok: false, error: 'invalid_key' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    await user.type(screen.getByLabelText('Anthropic API key'), 'sk-ant-wrong{Enter}');
    expect(await screen.findByText(/Anthropic did not accept this key/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save anyway' })).toBeNull();
    expect(calls(rejected.fetchMock, '/api/ai/connection')).toHaveLength(0);
    cleanup();

    const { fetchMock } = setup(status(), { ok: false, error: 'unreachable' });
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    await user.type(screen.getByLabelText('Anthropic API key'), 'sk-ant-offline{Enter}');
    expect(await screen.findByText(/Could not reach Anthropic to check the key/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(calls(fetchMock, '/api/ai/connection')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, '/api/ai/connection')[0]![1]!.body))).toEqual({
      mode: 'claude',
      model: '',
      apiKey: 'sk-ant-offline',
    });
  });

  it('moves between the three options from the Claude view', async () => {
    setup(status());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    await user.click(screen.getByRole('button', { name: 'Use Sign in with ChatGPT instead' }));
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    await user.click(screen.getByRole('button', { name: 'Use an OpenAI API key instead' }));
    expect(screen.getByLabelText('OpenAI API key')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    expect(screen.getByLabelText('Anthropic API key')).toBeTruthy();
  });

  it('explains each key with a "?" tip that names the right vendor, without changing the field name', async () => {
    setup(status());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use an OpenAI API key instead' }));
    // The tip sits outside the label: the field's name is still exactly the label.
    expect(screen.getByLabelText('OpenAI API key', { exact: true }).getAttribute('type')).toBe(
      'password',
    );
    await user.click(screen.getByRole('button', { name: 'What is an API key?' }));
    expect(screen.getByRole('link', { name: 'Get a key at OpenAI' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Use a Claude API key instead' }));
    await user.click(screen.getByRole('button', { name: 'What is a Claude API key?' }));
    expect(screen.getByRole('link', { name: 'Get a key at Anthropic' }).getAttribute('href')).toBe(
      'https://console.anthropic.com/settings/keys',
    );
  });
});

describe('keyTestMessage', () => {
  it('names a missing Anthropic credit and another refusal instead of "could not reach"', () => {
    const t = i18n.getFixedT('en', 'admin');
    expect(keyTestMessage(t, 'no_credit', 'claude')).toMatch(/no credit.*Billing/);
    expect(keyTestMessage(t, 'rejected', 'claude')).toMatch(/Anthropic refused the check/);
    expect(keyTestMessage(t, 'rejected', 'api')).toMatch(/OpenAI refused the check/);
    expect(keyTestMessage(t, 'no_credit', 'claude')).not.toMatch(/internet connection/);
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AiMemberStatus } from '@wa-team-inbox/shared';
import { AiConnectionSection } from './AiConnectionSection';
import { activateLocale } from '../i18n';

function status(): AiMemberStatus {
  return {
    member: null,
    settings: {
      displayName: 'Sales Assistant',
      enabled: false,
      mode: 'api',
      model: '',
      instructions: '',
    },
    hasApiKey: true,
    connection: { state: 'signed_out', loginUrl: null, error: null },
    documents: [],
  };
}
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}
function setup(
  initial = status(),
  respond?: (url: string, init?: RequestInit) => Response | undefined,
) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = respond?.(url, init);
    if (custom) return custom;
    if (url === '/api/ai/connection' && init?.method === 'PATCH') {
      const { apiKey: _key, ...settings } = JSON.parse(String(init.body));
      current = { ...current, settings: { ...current.settings, ...settings } };
      return json(current);
    }
    if (url === '/api/ai') return json(current);
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AiConnectionSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetchMock, setStatus: (next: AiMemberStatus) => void (current = next) };
}
const patchBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(String(fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH')![1]!.body));

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  cleanup();
  await activateLocale('en');
  vi.unstubAllGlobals();
});

describe('Settings → AI connection (inline)', () => {
  it('edits in place with one Save and an Unsaved marker', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    const model = await screen.findByLabelText('Model (optional)');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Unsaved')).toBeNull();
    await user.type(model, 'gpt-4.1-mini');
    expect(screen.getByText('Unsaved')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }));
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull());
    expect(patchBody(fetchMock)).toEqual({ mode: 'api', model: 'gpt-4.1-mini' });
  });

  it('switches with the segmented control, labels ChatGPT experimental and offers Auto first', async () => {
    const initial = status();
    initial.settings.model = 'gpt-4.1-mini';
    const { fetchMock } = setup(initial, (url) =>
      url === '/api/ai/models'
        ? json({
            source: 'live',
            models: [
              { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
              { id: 'gpt-5.5', label: 'GPT-5.5' },
            ],
          })
        : undefined,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /ChatGPT/ }));
    expect(screen.getByText('Experimental')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain(
      'Auto (recommended)',
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Auto (recommended)',
        'GPT-6.1-Sol',
        'GPT-5.5',
      ]),
    );
    await user.click(screen.getByRole('option', { name: 'GPT-5.5' }));
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }));
    await waitFor(() =>
      expect(patchBody(fetchMock)).toEqual({ mode: 'chatgpt', model: 'gpt-5.5' }),
    );
  });

  it('signs in with one click: saves ChatGPT mode, starts sign-in and opens the page', async () => {
    const tab = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
    const open = vi.fn(() => tab);
    vi.stubGlobal('open', open);
    const loginUrl = 'https://auth.openai.com/oauth/authorize?state=test';
    const { fetchMock, setStatus } = setup(status(), (url, init) => {
      if (url === '/api/ai/chatgpt/login' && init?.method === 'POST') {
        const signingIn: AiMemberStatus = {
          ...status(),
          settings: { ...status().settings, mode: 'chatgpt' },
          connection: { state: 'signing_in', loginUrl, error: null },
        };
        setStatus(signingIn);
        return json(signingIn);
      }
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /ChatGPT/ }));
    await user.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));
    await waitFor(() => expect(tab.location.href).toBe(loginUrl));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    const writes = fetchMock.mock.calls.filter((call) => call[1]?.method !== 'GET');
    expect(writes.map((call) => `${call[1]?.method} ${call[0]}`)).toEqual([
      'PATCH /api/ai/connection',
      'POST /api/ai/chatgpt/login',
    ]);
  });

  it('falls back to an Open sign-in link when the browser blocks the tab', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    const initial = status();
    initial.settings.mode = 'chatgpt';
    const signingIn: AiMemberStatus = {
      ...initial,
      connection: {
        state: 'signing_in',
        loginUrl: 'https://auth.openai.com/oauth/authorize?state=test',
        error: null,
      },
    };
    setup(initial, (url, init) =>
      url === '/api/ai/chatgpt/login' && init?.method === 'POST' ? json(signingIn) : undefined,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }));
    const link = await screen.findByRole('link', { name: 'Open sign-in' });
    expect(link.getAttribute('href')).toBe(signingIn.connection.loginUrl);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/blocked from opening/)).toBeTruthy();
  });

  it('finishes sign-in from a pasted address (admin on another computer)', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = {
      state: 'signing_in',
      loginUrl: 'https://auth.openai.com/oauth/authorize?state=test',
      error: null,
    };
    const connected: AiMemberStatus = {
      ...initial,
      connection: { state: 'connected', loginUrl: null, error: null, email: 'owner@example.com' },
    };
    let done = false;
    const pasted = 'http://localhost:1455/auth/callback?code=abc&state=test';
    const { fetchMock } = setup(initial, (url, init) => {
      if (url === '/api/ai/chatgpt/callback' && init?.method === 'POST') {
        done = true;
        return json(connected);
      }
      if (url === '/api/ai' && done) return json(connected);
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Signing in on another computer?'), pasted);
    await user.click(screen.getByRole('button', { name: 'Finish sign-in' }));
    await screen.findByText('Signed in as owner@example.com');
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/ai/chatgpt/callback')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ url: pasted });
  });

  it('tests the saved connection and shows the reply and model', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = { state: 'connected', loginUrl: null, error: null, email: null };
    setup(initial, (url, init) =>
      url === '/api/ai/chatgpt/test' && init?.method === 'POST'
        ? json({ ok: true, model: 'gpt-6.1-sol', reply: 'OK', error: null })
        : undefined,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    await screen.findByText('gpt-6.1-sol replied: OK');
  });

  it('shows one banner when the sign-in expired, with Sign in and Sign out', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = {
      state: 'expired',
      loginUrl: null,
      error: 'ChatGPT sign-in expired. Sign in again.',
      email: 'owner@example.com',
    };
    setup(initial);
    expect(await screen.findByText('ChatGPT sign-in expired')).toBeTruthy();
    expect(screen.getByText('ChatGPT sign-in expired. Sign in again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('keeps the model typed for each mode while flipping, and clears Unsaved when back to saved', async () => {
    setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Model (optional)'), 'gpt-4.1-mini');
    expect(screen.getByText('Unsaved')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /ChatGPT/ }));
    await user.click(screen.getByRole('radio', { name: 'API key' }));
    expect(((await screen.findByLabelText('Model (optional)')) as HTMLInputElement).value).toBe(
      'gpt-4.1-mini',
    );
    await user.clear(screen.getByLabelText('Model (optional)'));
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('offers no Sign out or Test after a failed first sign-in (no tokens)', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = { state: 'error', loginUrl: null, error: 'Sign-in failed', email: null };
    setup(initial);
    expect(await screen.findByText('ChatGPT connection stopped working')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull();
  });

  it('shows the rate-limit message when starting sign-in is refused (429)', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => ({ opener: {}, location: { href: '' }, close: vi.fn() })),
    );
    const initial = status();
    initial.settings.mode = 'chatgpt';
    setup(initial, (url, init) =>
      url === '/api/ai/chatgpt/login' && init?.method === 'POST'
        ? json({ error: { code: 'rate_limited', message: 'Too many attempts, retry in 30s' } }, 429)
        : undefined,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }));
    await screen.findByText('Too many attempts. Try again in 30 s.');
  });

  it('shows the rate-limit message when the pasted address is refused (429)', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = {
      state: 'signing_in',
      loginUrl: 'https://auth.openai.com/oauth/authorize?state=test',
      error: null,
    };
    setup(initial, (url, init) =>
      url === '/api/ai/chatgpt/callback' && init?.method === 'POST'
        ? json({ error: { code: 'rate_limited', message: 'Too many attempts, retry in 30s' } }, 429)
        : undefined,
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('Signing in on another computer?'),
      'http://localhost:1455/x',
    );
    await user.click(screen.getByRole('button', { name: 'Finish sign-in' }));
    await screen.findByText('Too many attempts. Try again in 30 s.');
  });

  it('shows a failed connection test', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = { state: 'connected', loginUrl: null, error: null, email: 'a@b.co' };
    setup(initial, (url, init) =>
      url === '/api/ai/chatgpt/test' && init?.method === 'POST'
        ? json({ ok: false, model: null, reply: null, error: 'Model not available' })
        : undefined,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    await screen.findByText(/Model not available/);
  });

  it('keeps an unsaved draft while the language changes', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Model (optional)'), 'gpt-4.1-mini');
    await act(() => activateLocale('ms'));
    expect(((await screen.findByLabelText('Model (pilihan)')) as HTMLInputElement).value).toBe(
      'gpt-4.1-mini',
    );
    await user.click(screen.getByRole('button', { name: 'Simpan sambungan AI' }));
    await waitFor(() =>
      expect(patchBody(fetchMock)).toEqual({ mode: 'api', model: 'gpt-4.1-mini' }),
    );
  });
});

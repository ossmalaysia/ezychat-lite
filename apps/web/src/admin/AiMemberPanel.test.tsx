import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AiMemberStatus } from '@wa-team-inbox/shared';
import { AiMemberPanel } from './AiMemberPanel';

function status(): AiMemberStatus {
  return {
    member: {
      id: 3,
      username: 'ai-assistant',
      displayName: 'Sales Assistant',
      role: 'agent',
      kind: 'ai',
      mustChangePassword: false,
      disabled: true,
      createdAt: 1,
    },
    settings: {
      displayName: 'Sales Assistant',
      enabled: false,
      mode: 'api',
      model: '',
      instructions: '',
      notes: '',
      faqs: [],
    },
    hasApiKey: true,
    connection: { state: 'signed_out', loginUrl: null, error: null },
    documents: [],
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(
  initial = status(),
  respond?: (url: string, init?: RequestInit) => Response | undefined,
  section: 'member' | 'connection' = 'member',
) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = respond?.(url, init);
    if (custom) return custom;
    if (
      (url === '/api/ai' && init?.method === 'PUT') ||
      (url === '/api/ai/connection' && init?.method === 'PATCH')
    ) {
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
        <AiMemberPanel onClose={vi.fn()} section={section} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    fetchMock,
    setStatus: (next: AiMemberStatus) => {
      current = next;
    },
  };
}

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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AI member settings', () => {
  it.each([
    { mode: 'api' as const, model: 'gpt-4.1-mini', option: 'ChatGPT sign-in', next: 'chatgpt' },
    { mode: 'chatgpt' as const, model: 'gpt-5.3-codex', option: 'OpenAI API key', next: 'api' },
  ])(
    'resets an explicit $mode model when switching providers and saves the new default',
    async ({ mode, model, option, next }) => {
      const initial = status();
      initial.settings.mode = mode;
      initial.settings.model = model;
      const { fetchMock } = setup(initial, undefined, 'connection');
      const user = userEvent.setup();
      const input = await screen.findByLabelText('Model (optional)');
      expect((input as HTMLInputElement).value).toBe(model);
      await user.click(screen.getByRole('combobox', { name: 'Connection mode' }));
      await user.click(screen.getByRole('option', { name: option }));
      expect((input as HTMLInputElement).value).toBe('');
      await user.click(screen.getByRole('button', { name: 'Save AI connection' }));
      await waitFor(() =>
        expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(true),
      );
      const saved = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH')!;
      expect(JSON.parse(String(saved[1]?.body))).toEqual({ mode: next, model: '' });
    },
  );

  it('rejects an unsupported ChatGPT model before submitting the connection', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    const { fetchMock } = setup(initial, undefined, 'connection');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Model (optional)'), 'gpt-4.1-mini');
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }));
    await screen.findByText(
      'ChatGPT mode supports gpt-5.4 or gpt-5.3-codex. Leave blank to use the default.',
    );
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false);
  });

  it('requires saving a changed connection mode before exposing ChatGPT sign-in controls', async () => {
    const initial = status();
    initial.connection.state = 'connected';
    const { fetchMock } = setup(initial, undefined, 'connection');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Connection mode' }));
    await user.click(screen.getByRole('option', { name: 'ChatGPT sign-in' }));
    expect(screen.queryByText('ChatGPT: connected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect ChatGPT' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in to ChatGPT' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/ai/chatgpt/login')).toBe(false);
  });
  it('saves notes and FAQs without changing the shared inbox connection', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Business notes'), 'Open Monday to Friday.');
    await user.click(screen.getByRole('button', { name: 'Add FAQ' }));
    await user.type(screen.getByLabelText('Question 1'), 'Do you deliver?');
    await user.type(screen.getByLabelText('Answer 1'), 'Yes, within Kuala Lumpur.');
    await user.click(screen.getByRole('button', { name: 'Save AI member' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(true),
    );
    const saved = fetchMock.mock.calls.find((call) => call[1]?.method === 'PUT')!;
    expect(JSON.parse(String(saved[1]?.body))).toMatchObject({
      notes: 'Open Monday to Friday.',
      faqs: [{ question: 'Do you deliver?', answer: 'Yes, within Kuala Lumpur.' }],
    });
    expect(JSON.parse(String(saved[1]?.body))).not.toHaveProperty('apiKey');
    expect(JSON.parse(String(saved[1]?.body))).not.toHaveProperty('mode');
    expect(JSON.parse(String(saved[1]?.body))).not.toHaveProperty('model');
    expect(screen.queryByLabelText('OpenAI API key')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Configure in Settings → AI' }).getAttribute('href'),
    ).toBe('/admin/settings');
  });

  it('saves inbox connection separately and keeps saved keys hidden and clears replacements', async () => {
    const initial = status();
    initial.member = null;
    const { fetchMock } = setup(initial, undefined, 'connection');
    const user = userEvent.setup();
    const key = (await screen.findByLabelText('OpenAI API key')) as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(true),
    );
    const saved = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH')!;
    expect(JSON.parse(String(saved[1]?.body))).toEqual({ mode: 'api', model: '' });
    await user.type(key, 'sk-test-replacement');
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }));
    await waitFor(() => expect(key.value).toBe(''));
    const patches = fetchMock.mock.calls.filter((call) => call[1]?.method === 'PATCH');
    expect(JSON.parse(String(patches[1]?.[1]?.body)).apiKey).toBe('sk-test-replacement');
    expect(screen.queryByLabelText('AI member name')).toBeNull();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false);
  });

  it('uploads and removes business documents without replacing unsaved notes', async () => {
    const next = status();
    const document = { id: 7, name: 'hours.md', size: 10, characters: 10, createdAt: 1 };
    const { fetchMock } = setup(next, (url, init) => {
      if (url === '/api/ai/documents') return json({ ...next, documents: [document] });
      if (url === '/api/ai/documents/7' && init?.method === 'DELETE') return json(next);
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Business notes'), 'Unsaved facts');
    await user.upload(
      screen.getByLabelText('Upload business document'),
      new File(['open daily'], 'hours.md', { type: 'text/markdown' }),
    );
    await screen.findByText('hours.md');
    const upload = fetchMock.mock.calls.find((call) => call[0] === '/api/ai/documents')!;
    expect((upload[1]?.body as FormData).get('file')).toBeInstanceOf(File);
    expect((screen.getByLabelText('Business notes') as HTMLTextAreaElement).value).toBe(
      'Unsaved facts',
    );
    await user.click(screen.getByRole('button', { name: 'Remove hours.md' }));
    await waitFor(() => expect(screen.queryByText('hours.md')).toBeNull());
  });

  it('starts ChatGPT sign-in and polls until connected without losing unsaved settings', async () => {
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
    const { setStatus } = setup(
      initial,
      (url, init) =>
        url === '/api/ai/chatgpt/login' && init?.method === 'POST' ? json(signingIn) : undefined,
      'connection',
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Model (optional)'), 'keep-draft-model');
    await user.click(screen.getByRole('button', { name: 'Sign in to ChatGPT' }));
    const link = await screen.findByRole('link', { name: 'Open sign-in' });
    expect(link.getAttribute('href')).toBe(signingIn.connection.loginUrl);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    setStatus({ ...initial, connection: { state: 'connected', loginUrl: null, error: null } });
    await screen.findByText('ChatGPT: connected', {}, { timeout: 4000 });
    expect((screen.getByLabelText('Model (optional)') as HTMLInputElement).value).toBe(
      'keep-draft-model',
    );
    expect(screen.getByRole('button', { name: 'Disconnect ChatGPT' })).toBeTruthy();
  });

  it('shows server failures and rejects an unsafe sign-in link', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = {
      state: 'signing_in',
      loginUrl: 'https://evil.example/steal',
      error: null,
    };
    setup(
      initial,
      (_url, init) =>
        init?.method === 'PATCH'
          ? json(
              {
                error: {
                  code: 'ai_not_ready',
                  message: 'Connect ChatGPT before enabling replies.',
                },
              },
              409,
            )
          : undefined,
      'connection',
    );
    const user = userEvent.setup();
    await screen.findByText('The sign-in link is invalid. Cancel sign-in and try again.');
    expect(screen.queryByRole('link', { name: 'Open sign-in' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }));
    await screen.findByText('Connect ChatGPT before enabling replies.');
  });

  it('requires initial member save before document uploads', async () => {
    const initial = status();
    initial.member = null;
    initial.settings.mode = 'chatgpt';
    setup(initial);
    const input = (await screen.findByLabelText('Upload business document')) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AiMemberBody, AiMemberStatus, User } from '@wa-team-inbox/shared';
import { AiMemberPage } from './AiMemberPage';

const aiUser: User = {
  id: 3,
  username: 'ai-assistant',
  displayName: 'Sales Assistant',
  role: 'agent',
  kind: 'ai',
  mustChangePassword: false,
  disabled: true,
  createdAt: 1,
  locale: null,
};
function status(): AiMemberStatus {
  return {
    member: { ...aiUser },
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
    connection: { state: 'connected', loginUrl: null, error: null },
    documents: [],
  };
}
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
function setup(
  initial = status(),
  respond?: (
    url: string,
    init: RequestInit | undefined,
    current: AiMemberStatus,
  ) => Response | undefined,
) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = respond?.(url, init, current);
    if (custom) return custom;
    if (url === '/api/ai' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as AiMemberBody;
      current = {
        ...current,
        member: {
          ...(current.member ?? aiUser),
          displayName: body.displayName,
          disabled: !body.enabled,
        },
        settings: { ...current.settings, ...body },
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
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/members/ai']}>
        <Routes>
          <Route path="/admin/members/ai" element={<AiMemberPage />} />
          <Route path="/admin/settings/ai" element={<h1>Settings AI</h1>} />
          <Route path="/admin/members" element={<h1>Members list</h1>} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetchMock };
}
const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((call) => call[1]?.method && call[1].method !== 'GET');

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

describe('AI member page', () => {
  it('keeps Turn on disabled with the reason until the connection works', async () => {
    const initial = status();
    initial.hasApiKey = false;
    initial.settings.notes = 'Delivery RM10';
    setup(initial);
    const turnOn = (await screen.findByRole('button', { name: 'Turn on' })) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    expect(screen.getByText('Needs connection')).toBeTruthy();
    expect(screen.getByText('Connect the AI in Settings → AI first.')).toBeTruthy();
  });

  it('keeps Turn on disabled until there is knowledge', async () => {
    setup();
    const user = userEvent.setup();
    const turnOn = (await screen.findByRole('button', { name: 'Turn on' })) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    expect(screen.getByText('Needs knowledge')).toBeTruthy();
    await user.type(screen.getByLabelText('Business notes'), 'Delivery RM10');
    expect(screen.getByText('Off')).toBeTruthy();
    expect(turnOn.disabled).toBe(false);
  });

  it('Turn on saves unsaved edits in the same request', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Business notes'), 'Delivery costs RM10.');
    expect(screen.getByText('Unsaved')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await screen.findByRole('button', { name: 'Turn off' });
    expect(screen.getByText('On')).toBeTruthy();
    const puts = writes(fetchMock);
    expect(puts.map((call) => `${call[1]!.method} ${call[0]}`)).toEqual(['PUT /api/ai']);
    expect(JSON.parse(String(puts[0]![1]!.body))).toMatchObject({
      displayName: 'Sales Assistant',
      notes: 'Delivery costs RM10.',
      enabled: true,
    });
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('Try it sends the current unsaved knowledge and shows the answer and model', async () => {
    const { fetchMock } = setup(status(), (url, init) =>
      url === '/api/ai/try' && init?.method === 'POST'
        ? json({
            ok: true,
            reply: 'Delivery is RM10.',
            action: 'answer',
            model: 'gpt-6.1-sol',
            error: null,
          })
        : undefined,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Business notes'), 'Delivery costs RM10.');
    await user.type(screen.getByLabelText('Customer question'), 'How much is delivery?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Delivery is RM10.');
    expect(screen.getByText('Model: gpt-6.1-sol')).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/ai/try')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      question: 'How much is delivery?',
      knowledge: {
        displayName: 'Sales Assistant',
        instructions: '',
        notes: 'Delivery costs RM10.',
        faqs: [],
      },
    });
    expect(writes(fetchMock).some((c) => c[1]!.method === 'PUT')).toBe(false);
  });

  it('uploading before the first save creates a draft member, then uploads, keeping typed text', async () => {
    const initial = status();
    initial.member = null;
    const { fetchMock } = setup(initial, (url, init, current) =>
      url === '/api/ai/documents' && init?.method === 'POST'
        ? json({
            ...current,
            documents: [{ id: 1, name: 'hours.md', size: 12, characters: 12, createdAt: 1 }],
          })
        : undefined,
    );
    const user = userEvent.setup();
    const name = await screen.findByLabelText('AI member name');
    await user.clear(name);
    await user.type(name, 'Ezy Bot');
    await user.type(screen.getByLabelText('Business notes'), 'Open 9 to 5');
    await user.upload(
      screen.getByLabelText('Upload business document'),
      new File(['Delivery RM10'], 'hours.md', { type: 'text/markdown' }),
    );
    await screen.findByText('hours.md');
    expect(writes(fetchMock).map((call) => `${call[1]!.method} ${call[0]}`)).toEqual([
      'PUT /api/ai',
      'POST /api/ai/documents',
    ]);
    expect(JSON.parse(String(writes(fetchMock)[0]![1]!.body))).toMatchObject({
      displayName: 'Ezy Bot',
      notes: 'Open 9 to 5',
      enabled: false,
    });
    expect((screen.getByLabelText('Business notes') as HTMLTextAreaElement).value).toBe(
      'Open 9 to 5',
    );
  });

  it('shows the connection banner and deep-links to Settings → AI', async () => {
    const initial = status();
    initial.settings.mode = 'chatgpt';
    initial.connection = {
      state: 'error',
      loginUrl: null,
      error: 'ChatGPT stopped accepting this connection.',
      email: 'owner@example.com',
    };
    setup(initial);
    const user = userEvent.setup();
    expect(await screen.findByText('ChatGPT connection stopped working')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Settings → AI' });
    expect(links.every((link) => link.getAttribute('href') === '/admin/settings/ai')).toBe(true);
    await user.click(links[0]!);
    expect(screen.getByTestId('location').textContent).toBe('/admin/settings/ai');
  });

  it('keeps How it works collapsed and links back to Members', async () => {
    setup();
    const summary = await screen.findByText('How it works');
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('href')).toBe(
      '/admin/members',
    );
  });
});

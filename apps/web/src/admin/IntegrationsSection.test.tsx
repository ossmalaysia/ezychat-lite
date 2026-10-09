import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ApiToken, McpSettingsResponse } from '@wa-team-inbox/shared';
import { IntegrationsSection } from './IntegrationsSection';

const SECRET = 'ezc_pat_froJ8vQm2kT0bXcY_7dPzLwq4Hn-ReA9uS1fGvK3iM5';
const DAY = 24 * 60 * 60 * 1000;
/** The port the server listens on differs from the saved port setting (7420) on purpose. */
const LOCAL = 'http://127.0.0.1:7433';
const SERVER_ERROR = { error: { code: 'internal', message: 'Internal server error' } };

function token(over: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 1,
    userId: 1,
    userName: 'Owner',
    name: 'Claude Code – office laptop',
    prefix: 'ezc_pat_froJ',
    createdAt: Date.now() - 10 * DAY,
    lastUsedAt: null,
    expiresAt: Date.now() + 80 * DAY,
    ...over,
  };
}

function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}

function setup({
  mcp = { enabled: false, endpointPath: '/mcp', publicUrl: null, localUrl: LOCAL },
  tokens = [],
  fail = {},
}: {
  mcp?: McpSettingsResponse;
  tokens?: ApiToken[];
  fail?: { patch?: boolean; post?: boolean; revokeGone?: boolean };
} = {}) {
  let settings = mcp;
  let list = tokens;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/integrations/mcp' && method === 'PATCH') {
      if (fail.patch) return json(SERVER_ERROR, 500);
      settings = { ...settings, ...JSON.parse(String(init!.body)) };
      return json(settings);
    }
    if (url === '/api/integrations/mcp') return json(settings);
    if (url === '/api/settings') return json({ port: 7420, lanEnabled: false, historyDays: 3 });
    if (url === '/api/integrations/tokens' && method === 'POST') {
      if (fail.post) return json(SERVER_ERROR, 500);
      const body = JSON.parse(String(init!.body));
      const created = token({ id: 9, name: body.name, expiresAt: null, createdAt: Date.now() });
      list = [...list, created];
      return json({ token: created, secret: SECRET }, 201);
    }
    if (url === '/api/integrations/tokens') return json({ tokens: list });
    const revoke = /^\/api\/integrations\/tokens\/(\d+)$/.exec(url);
    if (revoke && method === 'DELETE') {
      if (fail.revokeGone) {
        list = list.filter((t) => t.id !== Number(revoke[1]));
        return json({ error: { code: 'not_found', message: 'Token not found' } }, 404);
      }
      list = list.filter((t) => t.id !== Number(revoke[1]));
      return new Response(null, { status: 204 });
    }
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IntegrationsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetchMock, qc };
}

const calls = (fetchMock: ReturnType<typeof vi.fn>, method: string) =>
  fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === method);

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
  // Desktop width: ResponsiveDialog renders the centred Dialog.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Settings → Integrations', () => {
  it('turns AI assistant access on with PATCH', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    const toggle = await screen.findByRole('switch', { name: 'Let AI assistants read this inbox' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    const [patch] = calls(fetchMock, 'PATCH');
    expect(patch![0]).toBe('/api/integrations/mcp');
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ enabled: true });
    expect(screen.getByText(/Chats an assistant reads are sent/)).toBeTruthy();
  });

  it('warns when no tunnel runs and links to the Cloudflare page', async () => {
    setup();
    expect(await screen.findByText('No tunnel is running')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open Cloudflare settings' });
    expect(link.getAttribute('href')).toBe('/admin/tunnel');
    expect(await screen.findByText(/No tokens yet/)).toBeTruthy();
  });

  it('shows the tunnel URL and no warning when a tunnel runs', async () => {
    setup({
      mcp: {
        enabled: true,
        endpointPath: '/mcp',
        publicUrl: 'https://inbox.example.com',
        localUrl: LOCAL,
      },
    });
    expect(await screen.findByText('https://inbox.example.com')).toBeTruthy();
    expect(screen.queryByText('No tunnel is running')).toBeNull();
  });

  it('creates a token, shows the secret once, and clears it on Done', async () => {
    const { fetchMock, qc } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create access token' });
    // Name is required.
    await user.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(within(dialog).getByText('Enter a name.')).toBeTruthy();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Name'), 'Gemini CLI – office laptop');
    expect(
      within(dialog).getByRole('radio', { name: '90 days' }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(within(dialog).getByRole('radio', { name: '1 year' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create token' }));

    const created = await screen.findByRole('dialog', { name: 'Copy your token now' });
    const [post] = calls(fetchMock, 'POST');
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
      name: 'Gemini CLI – office laptop',
      expiresInDays: 365,
    });
    expect(within(created).getByTestId('api-token-secret').textContent).toBe(SECRET);
    const command = within(created).getByTestId('mcp-snippet-claude').textContent;
    expect(command).toBe(
      `claude mcp add --transport http ezychat http://127.0.0.1:7433/mcp --header "Authorization: Bearer ${SECRET}"`,
    );

    // The secret never enters the react-query caches.
    const cached = JSON.stringify([
      qc
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      qc
        .getMutationCache()
        .getAll()
        .map((m) => [m.state.data, m.state.variables]),
    ]);
    expect(cached).not.toContain(SECRET);

    await user.click(within(created).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(SECRET)).toBeNull();
    // The list refetched and shows the new token without its secret.
    expect(await screen.findByText('Gemini CLI – office laptop')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    const again = await screen.findByRole('dialog', { name: 'Create access token' });
    expect(within(again).queryByTestId('api-token-secret')).toBeNull();
    expect((within(again).getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('uses the tunnel URL in the setup snippets when a tunnel runs', async () => {
    setup({
      mcp: {
        enabled: true,
        endpointPath: '/mcp',
        publicUrl: 'https://inbox.example.com/',
        localUrl: LOCAL,
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create access token' });
    await user.type(within(dialog).getByLabelText('Name'), 'Laptop');
    await user.click(within(dialog).getByRole('button', { name: 'Create token' }));
    const created = await screen.findByRole('dialog', { name: 'Copy your token now' });
    await user.click(within(created).getByRole('tab', { name: 'Gemini CLI' }));
    expect(JSON.parse(within(created).getByTestId('mcp-snippet-gemini').textContent!)).toEqual({
      mcpServers: {
        ezychat: {
          httpUrl: 'https://inbox.example.com/mcp',
          headers: { Authorization: `Bearer ${SECRET}` },
        },
      },
    });
    await user.click(within(created).getByRole('tab', { name: 'Other' }));
    expect(within(created).getByTestId('mcp-snippet-url').textContent).toBe(
      'https://inbox.example.com/mcp',
    );
    expect(within(created).getByTestId('mcp-snippet-header').textContent).toBe(
      `Authorization: Bearer ${SECRET}`,
    );
    expect(within(created).getByText(/not supported yet/)).toBeTruthy();
  });

  it('marks expired tokens and lists the rest', async () => {
    setup({
      tokens: [
        token({ id: 1, name: 'Cursor trial', expiresAt: Date.now() - DAY }),
        token({
          id: 2,
          name: '老板的家用电脑 Gemini CLI（周末用来看客户统计和未回复的聊天）',
          userName: 'Siti Nurhaliza binti Abdullah',
          expiresAt: null,
          lastUsedAt: Date.now() - 5 * 60_000,
        }),
      ],
    });
    const rows = await screen.findAllByTestId('api-token-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(/^Expired /)).toBeTruthy();
    expect(within(rows[0]!).getByText('Never used')).toBeTruthy();
    expect(within(rows[0]!).getByText('ezc_pat_froJ…')).toBeTruthy();
    expect(within(rows[1]!).queryByText(/^Expired /)).toBeNull();
    expect(within(rows[1]!).getByText('Never expires')).toBeTruthy();
    expect(within(rows[1]!).getByText('Used 5 minutes ago')).toBeTruthy();
  });

  it('revokes a token after confirmation', async () => {
    const { fetchMock } = setup({ tokens: [token({ id: 4, name: 'Cursor trial' })] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke token Cursor trial' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Revoke “Cursor trial”?' });
    expect(calls(fetchMock, 'DELETE')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Revoke token' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const [del] = calls(fetchMock, 'DELETE');
    expect(del![0]).toBe('/api/integrations/tokens/4');
    expect(await screen.findByText(/No tokens yet/)).toBeTruthy();
  });

  it('clears the secret when the created dialog is closed with Escape', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create access token' });
    await user.type(within(dialog).getByLabelText('Name'), 'Laptop');
    await user.click(within(dialog).getByRole('button', { name: 'Create token' }));
    await screen.findByRole('dialog', { name: 'Copy your token now' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.textContent).not.toContain(SECRET);
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    const again = await screen.findByRole('dialog', { name: 'Create access token' });
    expect(within(again).queryByTestId('api-token-secret')).toBeNull();
  });

  it('keeps the form and shows no secret when creating fails', async () => {
    setup({ fail: { post: true } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create access token' });
    await user.type(within(dialog).getByLabelText('Name'), 'Laptop');
    await user.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(await within(dialog).findByText('Internal server error')).toBeTruthy();
    expect(screen.queryByTestId('api-token-secret')).toBeNull();
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Laptop');
  });

  it('treats revoking an already revoked token as done', async () => {
    setup({ tokens: [token({ id: 4, name: 'Cursor trial' })], fail: { revokeGone: true } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke token Cursor trial' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Revoke “Cursor trial”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Revoke token' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await screen.findByText(/No tokens yet/)).toBeTruthy();
  });

  it('shows an error when switching access fails', async () => {
    setup({ fail: { patch: true } });
    const user = userEvent.setup();
    const toggle = await screen.findByRole('switch', { name: 'Let AI assistants read this inbox' });
    await user.click(toggle);
    expect(await screen.findByText('Internal server error')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});

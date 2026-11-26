// AI assistants for team members (docs/features/mcp-for-members): "Your account → My AI assistants".
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiToken, McpSettingsResponse } from '@ezychat/shared';
import { MemberAssistantCard } from './MemberAssistantCard';

const auth = vi.hoisted(() => ({
  user: { id: 7, displayName: 'Daniel', chatScope: 'all' } as {
    id: number;
    displayName: string;
    chatScope?: 'all' | 'chosen';
  },
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const SETTINGS: McpSettingsResponse = {
  enabled: true,
  endpointPath: '/mcp',
  publicUrl: 'https://inbox.example.com',
  localUrl: 'http://127.0.0.1:7420',
  membersEnabled: true,
  canConnect: true,
  canMessageNewNumbers: false,
};

function app(over: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 5,
    userId: 7,
    userName: 'Daniel',
    name: 'Claude',
    prefix: 'ezc_pat_abcd',
    createdAt: Date.now() - 86_400_000,
    lastUsedAt: null,
    expiresAt: null,
    canSend: true,
    canMessageNewNumbers: false,
    canResolveChats: false,
    connectedApp: true,
    memberToken: true,
    ...over,
  };
}

const json = (data: unknown, code = 200) =>
  new Response(code === 204 ? null : JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

function setup({
  settings = SETTINGS,
  tokens = [app()],
}: { settings?: McpSettingsResponse; tokens?: ApiToken[] } = {}) {
  let list = tokens;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/integrations/mcp') return json(settings);
    if (url === '/api/integrations/tokens' && method === 'GET') return json({ tokens: list });
    const m = /^\/api\/integrations\/tokens\/(\d+)$/.exec(url);
    if (m && method === 'DELETE') {
      list = list.filter((x) => x.id !== Number(m[1]));
      return json(null, 204);
    }
    if (m && method === 'PATCH') {
      const body = JSON.parse(String(init!.body));
      list = list.map((x) => (x.id === Number(m[1]) ? { ...x, ...body } : x));
      return json({ token: list.find((x) => x.id === Number(m[1])) });
    }
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemberAssistantCard />
    </QueryClientProvider>,
  );
  return { fetchMock, user: userEvent.setup() };
}

beforeAll(() => {
  // jsdom lacks the pointer-capture calls Radix uses.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.user.chatScope = 'all';
  toast.success.mockReset();
});

describe('My AI assistants', () => {
  it('says to ask an admin while members may not connect, and loads no tokens', async () => {
    const { fetchMock } = setup({
      settings: { ...SETTINGS, membersEnabled: false, canConnect: false },
    });
    expect(await screen.findByTestId('member-assistant-off')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/integrations/tokens')).toBe(false);
    // never a way to create an access token
    expect(screen.queryByRole('button', { name: /token/i })).toBeNull();
  });

  it('shows the address to add and the member’s connected apps', async () => {
    setup();
    expect((await screen.findByTestId('member-assistant-url')).textContent).toBe(
      'https://inbox.example.com/mcp',
    );
    expect(screen.getByTestId('member-assistant-reach').textContent).toBe(
      'It sees the same chats you see in EzyChat Lite.',
    );
    const row = await screen.findByTestId('member-token-row');
    expect(within(row).getByText('Claude')).toBeTruthy();
    expect(within(row).getByText('Can send')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create/i })).toBeNull();
  });

  it('says a member limited to chosen chats sees only those', async () => {
    auth.user.chatScope = 'chosen';
    setup();
    expect((await screen.findByTestId('member-assistant-reach')).textContent).toBe(
      'It sees only the chats chosen for you.',
    );
  });

  it('shows the empty state', async () => {
    setup({ tokens: [] });
    expect(await screen.findByTestId('member-assistants-empty')).toBeTruthy();
  });

  it('disconnects an assistant after a confirm', async () => {
    const { fetchMock, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect Claude' }));
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => c[0] === '/api/integrations/tokens/5' && c[1]?.method === 'DELETE',
        ),
      ).toBe(true),
    );
    expect(toast.success).toHaveBeenCalledWith('Assistant disconnected');
    expect(await screen.findByTestId('member-assistants-empty')).toBeTruthy();
  });

  it('turns sending off in Permissions; new numbers stay greyed when the member cannot start chats', async () => {
    const { fetchMock, user } = setup();
    await user.click(await screen.findByRole('button', { name: /Permissions|Change/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/can't start new chats/)).toBeTruthy();
    const newNumbers = within(dialog).getByRole('checkbox', { name: /new numbers/i });
    expect(newNumbers.hasAttribute('disabled')).toBe(true);
    await user.click(within(dialog).getByRole('checkbox', { name: /Can send/i }));
    await user.click(within(dialog).getByRole('button', { name: /Save/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH');
      expect(JSON.parse(String(patch![1]!.body))).toEqual({
        canSend: false,
        canMessageNewNumbers: false,
      });
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OAuthConsentPage } from './OAuthConsentPage';

const QUERY =
  'response_type=code&client_id=ezc_app_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=abc&code_challenge_method=S256&state=xyz';
const BACK = 'https://claude.ai/api/mcp/auth_callback?code=c0de&state=xyz';

function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}

function setup({
  info = { clientName: 'Claude', redirectHost: 'claude.ai' } as unknown,
  infoStatus = 200,
  decisionStatus = 200,
} = {}) {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/oauth/request?')) return json(info, infoStatus);
    if (url === '/api/oauth/decision' && init?.method === 'POST') {
      if (decisionStatus !== 200) {
        return json({ error: { code: 'conflict', message: 'off' } }, decisionStatus);
      }
      const body = JSON.parse(String(init.body));
      return json({ redirectTo: body.approve ? BACK : `${BACK}&error=access_denied` });
    }
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/oauth/authorize?${QUERY}`]}>
        <Routes>
          <Route path="/oauth/authorize" element={<OAuthConsentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetchMock, assign };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MCP sign-in approval page', () => {
  it('shows the app, where it returns to and what it may do', async () => {
    const { fetchMock } = setup();
    expect(await screen.findByRole('heading', { name: 'Connect Claude?' })).toBeTruthy();
    expect(screen.getByTestId('oauth-host').textContent).toBe('claude.ai');
    expect(screen.getByText('Read chats, notes and statistics')).toBeTruthy();
    expect(screen.getByText(/It cannot send messages to customers/)).toBeTruthy();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/oauth/request?${QUERY}`);
  });

  it('approves with the request it was given and goes back to the app', async () => {
    const { fetchMock, assign } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(BACK));
    const post = fetchMock.mock.calls.find((c) => c[0] === '/api/oauth/decision')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      response_type: 'code',
      client_id: 'ezc_app_1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'xyz',
      approve: true,
    });
    // Both buttons stay disabled while the browser leaves.
    expect(screen.getByRole('button', { name: 'Decline' }).hasAttribute('disabled')).toBe(true);
  });

  it('declines and goes back to the app with access_denied', async () => {
    const { assign } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${BACK}&error=access_denied`));
  });

  it('names an app that gave no name', async () => {
    setup({ info: { clientName: '', redirectHost: 'chatgpt.com' } });
    expect(await screen.findByRole('heading', { name: 'Connect an AI assistant?' })).toBeTruthy();
  });

  it.each([
    [400, /not valid or has expired/],
    [403, /Only an admin can approve/],
    [409, /AI assistant access is off/],
  ])('explains a %i and never leaves the page', async (status, text) => {
    const { assign } = setup({
      info: { error: { code: 'x', message: 'server text' } },
      infoStatus: status,
    });
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cannot connect this app' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the inbox' }).getAttribute('href')).toBe('/');
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the page and shows why when the decision fails', async () => {
    const { assign } = setup({ decisionStatus: 409 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/AI assistant access is off/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
  });
});

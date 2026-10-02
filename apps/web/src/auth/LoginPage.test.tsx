import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

function renderLogin() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('submits username/password and shows the server error message', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/login') {
        return new Response(
          JSON.stringify({
            error: { code: 'unauthorized', message: 'Invalid username or password' },
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }), {
        status: 401,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid username or password')).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/login') as unknown as [
      string,
      RequestInit,
    ];
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call[1].body))).toEqual({ username: 'alice', password: 'secret123' });
  });
});

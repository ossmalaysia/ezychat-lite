import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhoneLink, formatPairingCode } from './PhoneLink';

describe('formatPairingCode', () => {
  it('groups 8 characters as XXXX-XXXX', () => {
    expect(formatPairingCode('abcd1234')).toBe('ABCD-1234');
    expect(formatPairingCode('ABCD-1234')).toBe('ABCD-1234');
  });
});

describe('PhoneLink', () => {
  afterEach(cleanup);

  it('requests a pairing code for the entered number and shows it', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'WXYZ9876' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PhoneLink />
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText(/whatsapp number/i), '+60 12-345 6789');
    await userEvent.click(screen.getByRole('button', { name: /get pairing code/i }));
    expect((await screen.findByTestId('pairing-code')).textContent).toBe('WXYZ-9876');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/wa/pairing-code');
    expect(JSON.parse(String(init.body))).toEqual({ phone: '+60 12-345 6789' });
    vi.unstubAllGlobals();
  });

  it('requests the code for one inbox when given its id', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'ABCD1234' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PhoneLink inboxId={2} />
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText(/whatsapp number/i);
    expect(input.id).toBe('wa-phone-2');
    await userEvent.type(input, '+60 11-2233 4455');
    await userEvent.click(screen.getByRole('button', { name: /get pairing code/i }));
    expect((await screen.findByTestId('pairing-code')).textContent).toBe('ABCD-1234');
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/inboxes/2/wa/pairing-code');
    vi.unstubAllGlobals();
  });
});

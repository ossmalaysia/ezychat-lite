import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Message } from '@wa-team-inbox/shared';
import { MediaView } from './MediaView';

const base: Message = {
  id: '3EB0ABC',
  chatJid: '60123456789@s.whatsapp.net',
  senderJid: null,
  senderName: null,
  fromMe: false,
  sentByUserId: null,
  type: 'audio',
  body: null,
  mediaUrl: null,
  mediaMime: 'audio/ogg',
  mediaName: null,
  mediaStatus: 'pending',
  quotedId: null,
  status: 'delivered',
  error: null,
  timestamp: 1,
  clientId: null,
};

function show(m: Message) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MediaView message={m} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('MediaView pending media', () => {
  it('history audio sent from the phone is loaded on demand, not shown as uploading', () => {
    show({ ...base, fromMe: true, status: 'read' });
    expect(screen.queryByText(/uploading/i)).toBeNull();
    expect(screen.getByRole('button', { name: /tap to load/i })).toBeTruthy();
  });

  it('a message still uploading from the app shows the upload spinner', () => {
    show({ ...base, id: 'local-abc', fromMe: true, status: 'pending' });
    expect(screen.getByText(/uploading/i)).toBeTruthy();
  });

  it('pending history images load automatically', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...base, type: 'image', mediaStatus: 'ok', mediaUrl: '/api/media/3EB0ABC' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    show({ ...base, type: 'image', mediaMime: 'image/jpeg' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe('/api/media/3EB0ABC/redownload');
  });
});

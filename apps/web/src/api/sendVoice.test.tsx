import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk, useSendVoice, type MessagesData } from './queries';

const JID = '60123456789@s.whatsapp.net';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useSendVoice', () => {
  it('uploads the recording to /voice and shows an optimistic voice note', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolveFetch = r;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const qc = new QueryClient();
    qc.setQueryData<MessagesData>(qk.messages(JID), {
      pages: [{ messages: [], nextBefore: null }],
      pageParams: [null],
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSendVoice(JID), { wrapper });
    const blob = new Blob(['opus'], { type: 'audio/webm;codecs=opus' });
    act(() => result.current.mutate({ blob, mime: blob.type, seconds: 2.4, clientId: 'cv1' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/chats/${encodeURIComponent(JID)}/voice`);
    const form = init.body as FormData;
    expect(form.get('clientId')).toBe('cv1');
    expect((form.get('file') as File).name).toBe('voice.webm');

    const optimistic = qc
      .getQueryData<MessagesData>(qk.messages(JID))!
      .pages.flatMap((p) => p.messages)
      .find((m) => m.id === 'local-cv1');
    expect(optimistic).toMatchObject({ type: 'audio', voice: true, mediaStatus: 'pending' });

    resolveFetch(
      new Response(
        JSON.stringify({ error: { code: 'validation', message: 'Voice note is empty' } }),
        { status: 400 },
      ),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

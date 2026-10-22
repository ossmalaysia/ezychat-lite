import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VOICE_MODEL_BYTES, type AiMemberStatus, type VoiceStatus } from '@ezychat/shared';
import { AiVoiceSection } from './AiVoiceSection';

function status(overrides: Partial<VoiceStatus> = {}, model: Partial<VoiceStatus['model']> = {}) {
  return {
    transcription: 'off',
    cloudAvailable: false,
    ...overrides,
    model: {
      state: 'not_installed',
      receivedBytes: 0,
      totalBytes: VOICE_MODEL_BYTES,
      error: null,
      ...model,
    },
  } as VoiceStatus;
}
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}
/** `aiMode`: the saved AI connection mode `/api/ai` reports (no answer when left out). */
function setup(initial: VoiceStatus, aiMode?: AiMemberStatus['settings']['mode']) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/ai' && aiMode)
      return json({
        member: null,
        settings: { displayName: 'AI', enabled: false, mode: aiMode, model: '', instructions: '' },
        hasApiKey: false,
        hasClaudeApiKey: aiMode === 'claude',
        connection: { state: 'connected', loginUrl: null, error: null },
        documents: [],
      });
    if (url === '/api/ai/voice' && method === 'PATCH') {
      current = { ...current, ...JSON.parse(String(init!.body)) };
      return json(current);
    }
    if (url === '/api/ai/voice/download') {
      current = status(current, { state: 'downloading', receivedBytes: 0 });
      return json(current);
    }
    if (url === '/api/ai/voice/cancel') {
      current = status(current);
      return json(current);
    }
    if (url === '/api/ai/voice/model' && method === 'DELETE') {
      current = status({ ...current, transcription: 'off' });
      return json(current);
    }
    if (url === '/api/ai/voice') return json(current);
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <AiVoiceSection />
    </QueryClientProvider>,
  );
  return { fetchMock, calls: (url: string) => fetchMock.mock.calls.filter(([u]) => u === url) };
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

describe('Settings → AI → Voice messages', () => {
  it('offers the download when the model is not installed and disables engines that cannot run', async () => {
    const { calls } = setup(status());
    const download = await screen.findByRole('button', { name: 'Download voice model (360 MB)' });
    expect(screen.getByText('Download the voice model below first.')).toBeTruthy();
    expect(
      screen.getByText('Needs a saved OpenAI API key in the AI connection above.'),
    ).toBeTruthy();
    expect((screen.getByRole('radio', { name: /On this PC/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('radio', { name: /Cloud/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /Off/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/voice notes never leave this computer/)).toBeTruthy();
    await userEvent.setup().click(download);
    await waitFor(() => expect(calls('/api/ai/voice/download')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'Cancel download' })).toBeTruthy();
  });

  it('shows download progress and cancels', async () => {
    const { calls } = setup(
      status({}, { state: 'downloading', receivedBytes: Math.floor(VOICE_MODEL_BYTES / 4) }),
    );
    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('24');
    expect(screen.getByText(/Downloading… 24%/).textContent).toContain('of 358 MB');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel download' }));
    await waitFor(() => expect(calls('/api/ai/voice/cancel')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: /Download voice model/ })).toBeTruthy();
  });

  it('shows an installed model, selects an engine and removes the model after confirming', async () => {
    const { fetchMock, calls } = setup(
      status({ transcription: 'local', cloudAvailable: true }, { state: 'installed' }),
    );
    expect(await screen.findByText('Installed')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Cloud/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === '/api/ai/voice' &&
            init?.method === 'PATCH' &&
            JSON.parse(String(init.body)).transcription === 'cloud',
        ),
      ).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove the voice model?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove model' }));
    await waitFor(() => expect(calls('/api/ai/voice/model')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: /Download voice model/ })).toBeTruthy();
  });

  it('explains a failed download and offers to try again', async () => {
    setup(status({}, { state: 'error', error: 'verification' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'did not match its expected checksum',
    );
    expect(screen.getByRole('button', { name: /Download voice model/ })).toBeTruthy();
  });

  it('hides Cloud with the Claude connection and says why', async () => {
    setup(status({ transcription: 'local' }, { state: 'installed' }), 'claude');
    expect(await screen.findByText(/Voice notes use the on-device model with Claude/)).toBeTruthy();
    expect(screen.getAllByRole('radio').map((radio) => radio.id)).toEqual([
      'voice-engine-off',
      'voice-engine-local',
    ]);
    expect(screen.queryByText(/With Cloud, the audio is sent to OpenAI/)).toBeNull();
    expect(
      screen.getByText(
        'On this PC, voice notes never leave this computer. Transcripts are stored with the chat.',
      ),
    ).toBeTruthy();
  });

  it('asks for another engine when Cloud was chosen before the switch to Claude', async () => {
    setup(status({ transcription: 'cloud' }, { state: 'installed' }), 'claude');
    expect(
      await screen.findByText(
        'Cloud transcription is off while the AI uses Claude. Choose On this PC or Off.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Cloud/ })).toBeNull();
  });

  it('keeps Cloud for the other connections', async () => {
    setup(status({ cloudAvailable: true }), 'api');
    await screen.findByRole('radio', { name: /Cloud/ });
    expect(screen.queryByText(/on-device model with Claude/)).toBeNull();
  });
});

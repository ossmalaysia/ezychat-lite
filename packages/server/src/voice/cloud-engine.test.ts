import { describe, expect, it, vi } from 'vitest';
import {
  CloudTranscribeError,
  OPENAI_TRANSCRIPTIONS_URL,
  transcribeCloud,
} from './cloud-engine.js';

const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);
const options = (fetch: typeof globalThis.fetch) => ({
  apiKey: 'sk-test-key-123',
  audio: AUDIO,
  extension: 'ogg',
  mime: 'audio/ogg',
  fetch,
});

describe('cloud transcription', () => {
  it('posts the original file as multipart to gpt-4o-transcribe without a language', async () => {
    const fetch = vi.fn(async () => Response.json({ text: 'Berapa harga ini?' }));
    expect(await transcribeCloud(options(fetch))).toEqual({
      text: 'Berapa harga ini?',
      lang: null,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_TRANSCRIPTIONS_URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test-key-123' });
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    expect(form.get('language')).toBeNull();
    const file = form.get('file') as File;
    expect(file.name).toBe('voice.ogg');
    expect(file.type).toBe('audio/ogg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(AUDIO);
  });

  it('retries once after a server error or network failure', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ text: 'hello' }));
    expect((await transcribeCloud(options(fetch))).text).toBe('hello');
    expect(fetch).toHaveBeenCalledTimes(2);

    const failing = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('timeout'));
    const error = await transcribeCloud(options(failing)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudTranscribeError);
    expect((error as CloudTranscribeError).status).toBe(0);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('does not retry a rejected request and never exposes the response body', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"error":"invalid key sk-test"}', { status: 401 }));
    const error = (await transcribeCloud(options(fetch)).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(CloudTranscribeError);
    expect(error.message).toBe('Transcription request failed (HTTP 401)');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('times out a hanging request', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)),
        ),
    );
    await expect(transcribeCloud({ ...options(fetch), timeoutMs: 10 })).rejects.toMatchObject({
      status: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

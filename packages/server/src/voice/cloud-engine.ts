import type { TranscriptResult } from './recognizer.js';

export const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
export const CLOUD_TIMEOUT_MS = 30_000;

/** Audio file extensions OpenAI's transcription endpoint accepts. */
export const CLOUD_AUDIO_EXTENSIONS = ['ogg', 'mp3', 'mp4', 'm4a', 'wav', 'webm', 'flac', 'mpeg'];

export class CloudTranscribeError extends Error {
  constructor(
    /** HTTP status, or 0 for network/timeout errors. Never includes response bodies. */
    readonly status: number,
  ) {
    super(
      status ? `Transcription request failed (HTTP ${status})` : 'Transcription request failed',
    );
    this.name = 'CloudTranscribeError';
  }
}

const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

/**
 * OpenAI `gpt-4o-transcribe`: the original file as-is (WhatsApp voice notes are Ogg/Opus), the
 * language auto-detected. 30-second timeout, one retry on network errors, 429 and 5xx. Redirects
 * are refused and neither request nor response bodies are logged.
 */
export async function transcribeCloud(options: {
  apiKey: string;
  audio: Uint8Array;
  /** e.g. `ogg`, one of CLOUD_AUDIO_EXTENSIONS */
  extension: string;
  mime: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<TranscriptResult> {
  const fetch = options.fetch ?? globalThis.fetch;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(options.audio)], { type: options.mime }),
      `voice.${options.extension}`,
    );
    form.append('model', OPENAI_TRANSCRIBE_MODEL);
    form.append('response_format', 'json');
    let response: Response;
    try {
      response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? CLOUD_TIMEOUT_MS),
      });
    } catch {
      lastStatus = 0;
      continue;
    }
    if (!response.ok) {
      lastStatus = response.status;
      await response.body?.cancel().catch(() => undefined);
      if (retryable(response.status)) continue;
      break;
    }
    const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
    if (!body || typeof body.text !== 'string') throw new CloudTranscribeError(response.status);
    return { text: body.text, lang: null };
  }
  throw new CloudTranscribeError(lastStatus);
}

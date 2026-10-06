import { VOICE_SAMPLE_RATE, decodeVoiceNote } from './audio.js';

export interface TranscriptResult {
  text: string;
  /** Detected language code (e.g. `en`), when the engine reports one. */
  lang: string | null;
}

/** The speech recognizer (sherpa-onnx Whisper in the worker; a fake in tests). */
export interface Recognizer {
  transcribe(samples: Float32Array, sampleRate: number): TranscriptResult;
}

export interface VoiceModelPaths {
  encoder: string;
  decoder: string;
  tokens: string;
}

/** Why a worker job failed; never carries audio or transcript text. */
export type TranscribeFailure = 'decode' | 'model' | 'recognize';

export class TranscribeError extends Error {
  constructor(readonly reason: TranscribeFailure) {
    super(`Transcription failed: ${reason}`);
    this.name = 'TranscribeError';
  }
}

/** Whisper reads 30-second windows: longer audio is split below that. */
export const WHISPER_CHUNK_SECONDS = 28;

/**
 * Splits samples into chunks of at most `maxSeconds`, cutting at the quietest 100 ms frame in the
 * last 3 seconds before each limit so words are rarely cut in half.
 */
export function splitForWhisper(
  samples: Float32Array,
  sampleRate = VOICE_SAMPLE_RATE,
  maxSeconds = WHISPER_CHUNK_SECONDS,
): Float32Array[] {
  const max = Math.floor(maxSeconds * sampleRate);
  if (samples.length <= max) return [samples];
  const frame = Math.floor(sampleRate / 10);
  const search = Math.min(max - frame, 3 * sampleRate);
  const chunks: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > max) {
    let cut = start + max;
    let quietest = Infinity;
    for (let end = start + max; end >= start + max - search; end -= frame) {
      let energy = 0;
      for (let i = end - frame; i < end; i++) energy += samples[i]! * samples[i]!;
      if (energy < quietest) {
        quietest = energy;
        cut = end;
      }
    }
    chunks.push(samples.subarray(start, cut));
    start = cut;
  }
  chunks.push(samples.subarray(start));
  return chunks;
}

/** sherpa-onnx reports the Whisper language as `<|en|>`; keep only a short code. */
export function normalizeLang(lang: unknown): string | null {
  if (typeof lang !== 'string') return null;
  const code = lang.replace(/[<|>]/g, '').trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(code) ? code : null;
}

/**
 * The worker's job: Ogg/Opus bytes → 16 kHz mono → recognizer, chunked for Whisper. The model is
 * loaded on the first job and kept for the worker's lifetime.
 */
export function createTranscribeHandler(load: () => Recognizer) {
  let recognizer: Recognizer | null = null;
  return async (audio: Uint8Array): Promise<TranscriptResult> => {
    let samples: Float32Array;
    try {
      samples = await decodeVoiceNote(audio);
    } catch {
      throw new TranscribeError('decode');
    }
    if (!recognizer) {
      try {
        recognizer = load();
      } catch {
        throw new TranscribeError('model');
      }
    }
    const texts: string[] = [];
    let lang: string | null = null;
    try {
      for (const chunk of splitForWhisper(samples)) {
        const result = recognizer.transcribe(chunk, VOICE_SAMPLE_RATE);
        lang ??= normalizeLang(result.lang);
        if (result.text.trim()) texts.push(result.text.trim());
      }
    } catch {
      throw new TranscribeError('recognize');
    }
    return { text: texts.join(' '), lang };
  };
}

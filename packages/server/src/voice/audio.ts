import { OggOpusDecoder } from 'ogg-opus-decoder';

/** Whisper (sherpa-onnx) input rate. */
export const VOICE_SAMPLE_RATE = 16_000;
const OPUS_RATE = 48_000;

/** An Ogg container (WhatsApp voice notes are Ogg/Opus). */
export function isOgg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x4f && // O
    bytes[1] === 0x67 && // g
    bytes[2] === 0x67 && // g
    bytes[3] === 0x53 // S
  );
}

function indexOf(bytes: Uint8Array, pattern: readonly number[], from = 0): number {
  outer: for (let i = from; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

const OGGS = [0x4f, 0x67, 0x67, 0x53];
const OPUS_HEAD = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64];

/**
 * Duration of an Ogg/Opus file from its last page's granule position minus the pre-skip, without
 * decoding (cheap enough for the request thread). Null when the file is not Ogg/Opus.
 */
export function oggOpusDurationSeconds(bytes: Uint8Array): number | null {
  if (!isOgg(bytes)) return null;
  const head = indexOf(bytes, OPUS_HEAD);
  if (head < 0 || head + 12 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const preSkip = view.getUint16(head + 10, true);
  for (let i = bytes.length - 27; i >= 0; i--) {
    if (bytes[i] !== 0x4f || indexOf(bytes.subarray(i, i + 4), OGGS) !== 0) continue;
    if (bytes[i + 4] !== 0) continue; // stream structure version
    const granule = view.getBigInt64(i + 6, true);
    if (granule < 0n) continue; // -1 = no packet ends on this page
    return Math.max(0, Number(granule) - preSkip) / OPUS_RATE;
  }
  return null;
}

/** Average all channels into one. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const length = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i]! += channel[i]!;
  for (let i = 0; i < length; i++) mono[i]! /= channels.length;
  return mono;
}

/**
 * Resample with a box low-pass when downsampling (each output averages the input samples it
 * covers, enough to stop speech aliasing) and linear interpolation when upsampling.
 */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const length = Math.floor((samples.length * to) / from);
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j]!;
      out[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < length; i++) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(samples.length - 1, left + 1);
      const fraction = position - left;
      out[i] = samples[left]! * (1 - fraction) + samples[right]! * fraction;
    }
  }
  return out;
}

/** Ogg/Opus bytes → mono 16 kHz Float32 PCM (pure WASM decoder, no native code). */
export async function decodeVoiceNote(bytes: Uint8Array): Promise<Float32Array> {
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const decoded = await decoder.decodeFile(bytes);
    if (!decoded.samplesDecoded) throw new Error('No audio decoded');
    return resample(downmix(decoded.channelData), decoded.sampleRate, VOICE_SAMPLE_RATE);
  } finally {
    decoder.free();
  }
}

import { OggOpusDecoder } from 'ogg-opus-decoder';

/** Whisper (sherpa-onnx) input rate. */
export const VOICE_SAMPLE_RATE = 16_000;
const OPUS_RATE = 48_000;
/** Longest voice note transcribed by either engine. */
export const VOICE_MAX_SECONDS = 120;

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

const OPUS_HEAD = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]; // "OpusHead"
const PAGE_HEADER = 27;
const BOS = 0x02;

/** Opus frame length in 48 kHz samples from a packet's TOC byte (RFC 6716 §3.1). */
function frameSamples(toc: number): number {
  const config = toc >> 3;
  if (config < 12) return [480, 960, 1920, 2880][config & 3]!; // SILK 10/20/40/60 ms
  if (config < 16) return [480, 960][config & 1]!; // Hybrid 10/20 ms
  return [120, 240, 480, 960][config & 3]!; // CELT 2.5/5/10/20 ms
}

/** Samples in one Opus packet, from its first two bytes; at most 120 ms per packet. */
function packetSamples(first: number, second: number | undefined): number | null {
  const code = first & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : second === undefined ? 0 : second & 0x3f;
  const samples = frames * frameSamples(first);
  return frames === 0 || samples > 5760 ? null : samples;
}

/**
 * Duration of an Ogg/Opus voice note, counted from the Opus packets themselves without decoding
 * (cheap enough for the request thread). The granule position in the file is sender-controlled and
 * is never trusted: a crafted note can claim 5 s and hold hours of audio. Null when the file is not
 * a single well-formed mono/stereo Ogg/Opus stream.
 */
export function oggOpusDurationSeconds(bytes: Uint8Array): number | null {
  if (!isOgg(bytes)) return null;
  let offset = 0;
  let serial: number | null = null;
  let packetIndex = 0; // 0 = OpusHead, 1 = OpusTags, then audio
  let packetBytes: number[] = []; // first bytes of the packet being assembled
  let packetOpen = false;
  let preSkip = 0;
  let samples = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset < bytes.length) {
    if (offset + PAGE_HEADER > bytes.length || !isOgg(bytes.subarray(offset, offset + 4)))
      return null;
    if (bytes[offset + 4] !== 0) return null; // stream structure version
    const flags = bytes[offset + 5]!;
    const pageSerial = view.getUint32(offset + 14, true);
    if (serial === null) {
      if (!(flags & BOS)) return null;
      serial = pageSerial;
    } else if (pageSerial !== serial || flags & BOS) return null; // chained or multiplexed streams
    const segments = bytes[offset + 26]!;
    let data = offset + PAGE_HEADER + segments;
    if (data > bytes.length) return null;
    for (let i = 0; i < segments; i++) {
      const length = bytes[offset + PAGE_HEADER + i]!;
      if (data + length > bytes.length) return null;
      if (!packetOpen) {
        packetOpen = true;
        packetBytes = [];
      }
      // Keep the first 19 bytes: enough for the OpusHead fields and an audio packet's TOC.
      for (let j = 0; j < length && packetBytes.length < 19; j++)
        packetBytes.push(bytes[data + j]!);
      data += length;
      if (length === 255) continue; // packet continues in the next segment
      packetOpen = false;
      if (packetIndex === 0) {
        if (packetBytes.length < 19 || OPUS_HEAD.some((byte, k) => packetBytes[k] !== byte))
          return null;
        const channels = packetBytes[9]!;
        if (channels < 1 || channels > 2) return null;
        preSkip = packetBytes[10]! | (packetBytes[11]! << 8);
      } else if (packetIndex > 1 && packetBytes.length > 0) {
        const count = packetSamples(packetBytes[0]!, packetBytes[1]);
        if (count === null) return null;
        samples += count;
      }
      packetIndex++;
    }
    offset = data;
  }
  if (packetIndex < 2) return null;
  return Math.max(0, samples - preSkip) / OPUS_RATE;
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
  // Re-check here so the worker never decodes a note whose real length was not counted.
  const seconds = oggOpusDurationSeconds(bytes);
  if (seconds === null || seconds > VOICE_MAX_SECONDS)
    throw new Error('Voice note too long or malformed');
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

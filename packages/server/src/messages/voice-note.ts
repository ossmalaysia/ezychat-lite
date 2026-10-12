import { isOgg, oggOpusDurationSeconds } from '../voice/audio.js';

/** Longest voice note the inbox records (the recorder stops itself at this length). */
export const VOICE_NOTE_MAX_SECONDS = 300;
/** Bars in a WhatsApp voice note waveform. */
const WAVEFORM_BARS = 64;

/**
 * Length of an Ogg/Opus voice note in whole seconds (at least 1), or null when the file is not a
 * well-formed Ogg/Opus stream or is longer than the recorder allows. Counted from the Opus packets,
 * never from the sender-controlled granule position.
 */
export function voiceNoteSeconds(bytes: Uint8Array): number | null {
  const exact = oggOpusDurationSeconds(bytes);
  if (exact === null || exact <= 0 || exact > VOICE_NOTE_MAX_SECONDS + 1) return null;
  return Math.max(1, Math.round(exact));
}

/** Byte length of every Opus audio packet (after OpusHead and OpusTags), in order. */
function packetSizes(bytes: Uint8Array): number[] {
  const sizes: number[] = [];
  let offset = 0;
  let current = 0;
  let packets = 0;
  while (offset + 27 <= bytes.length && isOgg(bytes.subarray(offset))) {
    const segments = bytes[offset + 26]!;
    const table = offset + 27;
    let body = table + segments;
    if (body > bytes.length) break;
    for (let i = 0; i < segments; i++) {
      const lace = bytes[table + i]!;
      current += lace;
      if (lace < 255) {
        if (packets++ >= 2) sizes.push(current);
        current = 0;
      }
    }
    for (let i = 0; i < segments; i++) body += bytes[table + i]!;
    offset = body;
  }
  return sizes;
}

/**
 * The 64-bar waveform WhatsApp draws on a voice note (values 0–100). Approximated from Opus packet
 * sizes, which grow with loudness and shrink to a few bytes in silence, so nothing is decoded on the
 * request thread. A flat stream (all packets the same size) draws a low, even line.
 */
export function voiceNoteWaveform(bytes: Uint8Array): Uint8Array {
  const sizes = packetSizes(bytes);
  const bars = new Uint8Array(WAVEFORM_BARS);
  if (!sizes.length) return bars;
  const means: number[] = [];
  for (let b = 0; b < WAVEFORM_BARS; b++) {
    const start = Math.floor((b * sizes.length) / WAVEFORM_BARS);
    const end = Math.max(start + 1, Math.floor(((b + 1) * sizes.length) / WAVEFORM_BARS));
    let sum = 0;
    for (let i = start; i < end && i < sizes.length; i++) sum += sizes[i]!;
    means.push(sum / (Math.min(end, sizes.length) - start || 1));
  }
  const min = Math.min(...means);
  const max = Math.max(...means);
  for (let b = 0; b < WAVEFORM_BARS; b++)
    bars[b] = max > min ? Math.round(((means[b]! - min) / (max - min)) * 100) : 10;
  return bars;
}

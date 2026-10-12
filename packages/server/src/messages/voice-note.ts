import { isOgg, oggOpusDurationSeconds } from '../voice/audio.js';

/** Longest voice note the inbox records (the recorder stops itself at this length). */
export const VOICE_NOTE_MAX_SECONDS = 300;
/** A 5-minute Opus voice note is well under 2 MB; anything far larger is not a recording. */
export const VOICE_NOTE_MAX_BYTES = 4 * 1024 * 1024;
/** Bars in a WhatsApp voice note waveform. */
const WAVEFORM_BARS = 64;

/**
 * Length of an Ogg/Opus voice note in whole seconds (at least 1), or null when the file is not a
 * well-formed Ogg/Opus stream, is longer than the recorder allows, or is far too large to be one.
 * Counted from the Opus packets, never from the sender-controlled granule position.
 */
export function voiceNoteSeconds(bytes: Uint8Array): number | null {
  if (bytes.length > VOICE_NOTE_MAX_BYTES) return null;
  const exact = oggOpusDurationSeconds(bytes);
  if (exact === null || exact <= 0 || exact > VOICE_NOTE_MAX_SECONDS + 1) return null;
  return Math.max(1, Math.round(exact));
}

/** Calls `visit` with the byte length of each non-empty Opus audio packet (after OpusHead/OpusTags). */
function forEachPacket(bytes: Uint8Array, visit: (size: number) => void): void {
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
        if (packets++ >= 2 && current > 0) visit(current);
        current = 0;
      }
    }
    for (let i = 0; i < segments; i++) body += bytes[table + i]!;
    offset = body;
  }
}

/**
 * The 64-bar waveform WhatsApp draws on a voice note (values 0–100). Approximated from Opus packet
 * sizes, which grow with loudness and shrink to a few bytes in silence, so nothing is decoded on the
 * request thread. Memory stays fixed (64 buckets) whatever the file holds. A flat stream (all packets
 * the same size) draws a low, even line.
 */
export function voiceNoteWaveform(bytes: Uint8Array): Uint8Array {
  const bars = new Uint8Array(WAVEFORM_BARS);
  let total = 0;
  forEachPacket(bytes, () => total++);
  if (!total) return bars;
  const sums = new Float64Array(WAVEFORM_BARS);
  const counts = new Uint32Array(WAVEFORM_BARS);
  let index = 0;
  forEachPacket(bytes, (size) => {
    const bar = Math.min(WAVEFORM_BARS - 1, Math.floor((index++ * WAVEFORM_BARS) / total));
    sums[bar]! += size;
    counts[bar]!++;
  });
  const means = Array.from(sums, (sum, b) => (counts[b] ? sum / counts[b]! : 0));
  const min = Math.min(...means);
  const max = Math.max(...means);
  for (let b = 0; b < WAVEFORM_BARS; b++)
    bars[b] = max > min ? Math.round(((means[b]! - min) / (max - min)) * 100) : 10;
  return bars;
}

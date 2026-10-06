import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VOICE_SAMPLE_RATE,
  decodeVoiceNote,
  downmix,
  isOgg,
  oggOpusDurationSeconds,
  resample,
  VOICE_MAX_SECONDS,
} from './audio.js';
import { craftedNote } from '../../test/fixtures/ogg.js';

/** 1 s, 440 Hz, mono Ogg/Opus at 48 kHz (ffmpeg libopus, 16 kbit/s voip): 2.4 KB. */
const TONE = new Uint8Array(
  readFileSync(join(import.meta.dirname, '../../test/fixtures/tone-1s.ogg')),
);

describe('voice audio', () => {
  it('recognises Ogg and reads the duration without decoding', () => {
    expect(isOgg(TONE)).toBe(true);
    expect(isOgg(new Uint8Array([0x49, 0x44, 0x33, 0x04]))).toBe(false);
    // Counted packets include the encoder's end padding that the granule position trims (~13 ms).
    expect(oggOpusDurationSeconds(TONE)).toBeCloseTo(1, 1);
    expect(oggOpusDurationSeconds(new Uint8Array(64))).toBeNull();
  });

  it('counts the real packets instead of trusting the sender-controlled granule position', async () => {
    const note = craftedNote(5); // claims 20 ms, holds 5 × 255 × 120 ms = 153 s
    expect(oggOpusDurationSeconds(note)).toBeCloseTo(153 - 312 / 48_000, 2);
    expect(oggOpusDurationSeconds(note)!).toBeGreaterThan(VOICE_MAX_SECONDS);
    await expect(decodeVoiceNote(note)).rejects.toThrow('too long or malformed');
    expect(oggOpusDurationSeconds(craftedNote(1))).toBeCloseTo(30.6 - 312 / 48_000, 2);
  });

  it('rejects chained streams, more than two channels and truncated pages', () => {
    expect(oggOpusDurationSeconds(craftedNote(1, 1, true))).toBeNull();
    expect(oggOpusDurationSeconds(craftedNote(1, 3))).toBeNull();
    expect(oggOpusDurationSeconds(TONE.subarray(0, TONE.length - 10))).toBeNull();
  });

  it('decodes an Ogg/Opus voice note to mono 16 kHz Float32 PCM', async () => {
    const samples = await decodeVoiceNote(TONE);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples.length).toBeGreaterThanOrEqual(VOICE_SAMPLE_RATE * 0.98);
    expect(samples.length).toBeLessThanOrEqual(VOICE_SAMPLE_RATE * 1.02);
    // A sine tone, not silence: its RMS is well above zero and within [-1, 1].
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    expect(rms).toBeGreaterThan(0.05);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(1.01);
  });

  it('rejects bytes that are not Ogg/Opus', async () => {
    await expect(decodeVoiceNote(new Uint8Array(100))).rejects.toThrow();
  });

  it('downmixes channels by averaging and resamples down and up', () => {
    expect(Array.from(downmix([new Float32Array([1, 0]), new Float32Array([0, 0])]))).toEqual([
      0.5, 0,
    ]);
    const ramp = Float32Array.from({ length: 48_000 }, (_, i) => i % 3);
    const down = resample(ramp, 48_000, 16_000);
    expect(down.length).toBe(16_000);
    expect(down[0]).toBeCloseTo(1); // average of 0, 1, 2
    const up = resample(new Float32Array([0, 1]), 8_000, 16_000);
    expect(Array.from(up)).toEqual([0, 0.5, 1, 1]);
  });
});

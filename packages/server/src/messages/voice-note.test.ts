import { describe, expect, it } from 'vitest';
import { oggOpus, opus120ms, opus20ms, opusPackets, webmOpus } from '../../test/voice-fixtures.js';
import {
  VoiceNoteError,
  opusPacketSamples,
  prepareVoiceNote,
  readOggOpus,
  voiceNoteSeconds,
} from './voice-note.js';

const PRE_SKIP_S = 312 / 48_000;

describe('opusPacketSamples', () => {
  it('reads the frame size and count from the TOC byte (RFC 6716 §3.1)', () => {
    expect(opusPacketSamples(opus20ms())).toBe(960); // CELT 20 ms, one frame
    expect(opusPacketSamples(Buffer.from([0xf9, 1, 2]))).toBe(1920); // two equal frames
    expect(opusPacketSamples(opus120ms())).toBe(5760); // code 3, six frames
    expect(opusPacketSamples(Buffer.from([0x18, 1]))).toBe(2880); // SILK 60 ms
    expect(opusPacketSamples(Buffer.from([0x60, 1]))).toBe(480); // hybrid 10 ms
    expect(opusPacketSamples(Buffer.from([0x80, 1]))).toBe(120); // CELT 2.5 ms
  });

  it('rejects empty packets and impossible frame counts', () => {
    expect(() => opusPacketSamples(Buffer.alloc(0))).toThrow(VoiceNoteError);
    expect(() => opusPacketSamples(Buffer.from([0xfb]))).toThrow(VoiceNoteError);
    expect(() => opusPacketSamples(Buffer.from([0xfb, 0x07, 0]))).toThrow(VoiceNoteError); // 140 ms
  });
});

describe('prepareVoiceNote', () => {
  it('remuxes a Chrome WebM/Opus recording into OGG/Opus without changing the packets', () => {
    const packets = Array.from({ length: 150 }, (_, i) => opus20ms(3 + (i % 5), i % 256));
    const note = prepareVoiceNote(webmOpus(packets));
    expect(note.ogg.subarray(0, 4).toString('latin1')).toBe('OggS');
    expect(note.channels).toBe(1);
    expect(note.seconds).toBeCloseTo(3 - PRE_SKIP_S, 3);
    const back = readOggOpus(note.ogg);
    expect(back.channels).toBe(1);
    expect(back.preSkip).toBe(312);
    expect(back.packets).toEqual(packets);
    expect(voiceNoteSeconds(note.ogg)).toBeCloseTo(note.seconds, 6);
  });

  it('reads the audio track when the WebM also has other tracks, and builds an OpusHead when absent', () => {
    const packets = opusPackets(1.2);
    expect(prepareVoiceNote(webmOpus(packets, { withVideoTrack: true })).seconds).toBeCloseTo(
      1.2 - PRE_SKIP_S,
      3,
    );
    const bare = prepareVoiceNote(webmOpus(packets, { codecPrivate: false }));
    expect(readOggOpus(bare.ogg).packets).toEqual(packets);
  });

  it('normalises a Firefox OGG/Opus recording', () => {
    const packets = opusPackets(6);
    const note = prepareVoiceNote(oggOpus(packets));
    expect(note.seconds).toBeCloseTo(6 - PRE_SKIP_S, 3);
    expect(readOggOpus(note.ogg).packets).toEqual(packets);
  });

  it('splits large packets across lacing values and pages', () => {
    const packets = Array.from({ length: 200 }, () => opus20ms(700));
    const note = prepareVoiceNote(webmOpus(packets));
    expect(readOggOpus(note.ogg).packets).toEqual(packets);
  });

  it('accepts exactly five minutes and rejects anything clearly longer', () => {
    expect(prepareVoiceNote(webmOpus(opusPackets(300))).seconds).toBeLessThanOrEqual(300);
    expect(() => prepareVoiceNote(webmOpus(opusPackets(310)))).toThrow(/5 minutes/);
    expect(() => prepareVoiceNote(oggOpus(opusPackets(310)))).toThrow(/5 minutes/);
  });

  it('rejects files that are not Opus voice recordings', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const reject = (b: Buffer, msg: RegExp) => {
      expect(() => prepareVoiceNote(b)).toThrow(VoiceNoteError);
      expect(() => prepareVoiceNote(b)).toThrow(msg);
    };
    reject(Buffer.alloc(0), /OGG\/Opus or WebM\/Opus/);
    reject(png, /OGG\/Opus or WebM\/Opus/);
    reject(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60, 7)]), /Invalid OGG/);
    const vorbis = Buffer.concat([Buffer.from([1]), Buffer.from('vorbis'), Buffer.alloc(23)]);
    reject(oggOpus(opusPackets(1), { firstPacket: vorbis }), /not Opus/);
    reject(webmOpus(opusPackets(1), { codecId: 'A_VORBIS' }), /not Opus/);
    reject(webmOpus(opusPackets(1), { channels: 6 }), /mono or stereo/);
    reject(oggOpus(opusPackets(1), { channels: 3 }), /mono or stereo/);
    reject(webmOpus(opusPackets(1), { laced: true }), /lacing/);
    reject(webmOpus([]), /empty/);
    reject(oggOpus([]), /empty/);
  });

  it('detects a corrupted OGG page checksum', () => {
    const ogg = oggOpus(opusPackets(1));
    ogg[ogg.length - 1] = ogg[ogg.length - 1]! ^ 0xff;
    expect(() => prepareVoiceNote(ogg)).toThrow(/Invalid OGG/);
  });

  it('accepts a recording whose last WebM block was cut off mid-write', () => {
    const webm = webmOpus(opusPackets(2));
    const note = prepareVoiceNote(webm.subarray(0, webm.length - 2));
    expect(note.seconds).toBeGreaterThan(1.7);
  });
});

/**
 * Voice notes: browsers record Opus in WebM (Chrome, Edge) or OGG (Firefox); WhatsApp voice notes
 * must be OGG/Opus. This module validates a recording and remuxes it into a fresh OGG/Opus stream.
 * Opus packets are copied unchanged (no decoding or re-encoding), so it stays small and pure TS.
 */
import { VOICE_NOTE_MAX_SECONDS } from '@wa-team-inbox/shared';

/** A recording that is not acceptable as a voice note; the message is safe to show (English). */
export class VoiceNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceNoteError';
  }
}

/** Stops at the limit can overrun by a few hundred milliseconds; allow that, nothing more. */
export const VOICE_NOTE_TOLERANCE_SECONDS = 1;

const OPUS_RATE = 48_000;
const MAX_PACKET_BYTES = 64 * 1024;
const DEFAULT_PRE_SKIP = 312;

export interface OpusStream {
  channels: number;
  preSkip: number;
  /** the OpusHead identification packet */
  head: Buffer;
  packets: Buffer[];
}

export interface VoiceNote {
  ogg: Buffer;
  /** playback length (pre-skip removed) */
  seconds: number;
  channels: number;
}

// ------------------------------------------------------------------ Opus

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(p: Buffer): number {
  if (p.length < 1) throw new VoiceNoteError('Voice note contains an empty Opus packet');
  const toc = p[0]!;
  const config = toc >> 3;
  let frame: number; // samples per frame
  if (config < 12)
    frame = [480, 960, 1920, 2880][config % 4]!; // SILK 10/20/40/60 ms
  else if (config < 16)
    frame = [480, 960][config % 2]!; // hybrid 10/20 ms
  else frame = [120, 240, 480, 960][config % 4]!; // CELT 2.5/5/10/20 ms
  const code = toc & 3;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code < 3) frames = 2;
  else {
    if (p.length < 2) throw new VoiceNoteError('Voice note contains a truncated Opus packet');
    frames = p[1]! & 0x3f;
  }
  const samples = frame * frames;
  if (frames < 1 || samples > 5760) {
    throw new VoiceNoteError('Voice note contains an invalid Opus packet');
  }
  return samples;
}

function parseOpusHead(head: Buffer): { channels: number; preSkip: number } {
  if (head.length < 19 || head.toString('latin1', 0, 8) !== 'OpusHead') {
    throw new VoiceNoteError('Voice note is not Opus audio');
  }
  const version = head[8]!;
  const channels = head[9]!;
  const mapping = head[18]!;
  if (version >> 4 !== 0) throw new VoiceNoteError('Voice note uses an unsupported Opus version');
  if (channels < 1 || channels > 2 || mapping !== 0) {
    throw new VoiceNoteError('Voice note must be mono or stereo Opus audio');
  }
  return { channels, preSkip: head.readUInt16LE(10) };
}

function buildOpusHead(channels: number, preSkip: number): Buffer {
  const b = Buffer.alloc(19);
  b.write('OpusHead', 0, 'latin1');
  b[8] = 1;
  b[9] = channels;
  b.writeUInt16LE(preSkip, 10);
  b.writeUInt32LE(OPUS_RATE, 12);
  return b;
}

function buildOpusTags(): Buffer {
  const vendor = Buffer.from('EzyChat Lite', 'latin1');
  const b = Buffer.alloc(8 + 4 + vendor.length + 4);
  b.write('OpusTags', 0, 'latin1');
  b.writeUInt32LE(vendor.length, 8);
  vendor.copy(b, 12);
  return b;
}

// ------------------------------------------------------------------ OGG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(buf: Buffer): number {
  let c = 0;
  for (let i = 0; i < buf.length; i++)
    c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ buf[i]!) & 0xff]!) >>> 0;
  return c;
}

const invalidOgg = () => new VoiceNoteError('Invalid OGG voice note');

/** Reads a single-stream OGG/Opus file: verifies page structure and checksums, returns its packets. */
export function readOggOpus(buf: Buffer): OpusStream {
  const packets: Buffer[] = [];
  let partial: Buffer[] = [];
  let partialLen = 0;
  let serial: number | null = null;
  let off = 0;
  while (off < buf.length) {
    if (buf.length - off < 27 || buf.toString('latin1', off, off + 4) !== 'OggS')
      throw invalidOgg();
    if (buf[off + 4] !== 0) throw invalidOgg();
    const pageSerial = buf.readUInt32LE(off + 14);
    if (serial === null) serial = pageSerial;
    else if (pageSerial !== serial)
      throw new VoiceNoteError('Voice note must contain one audio stream');
    const nseg = buf[off + 26]!;
    const bodyStart = off + 27 + nseg;
    if (bodyStart > buf.length) throw invalidOgg();
    let bodyLen = 0;
    for (let i = 0; i < nseg; i++) bodyLen += buf[off + 27 + i]!;
    const end = bodyStart + bodyLen;
    if (end > buf.length) throw invalidOgg();
    const pageBuf = Buffer.from(buf.subarray(off, end));
    const stored = pageBuf.readUInt32LE(22);
    pageBuf.writeUInt32LE(0, 22);
    if (oggCrc(pageBuf) !== stored) throw invalidOgg();
    let p = bodyStart;
    for (let i = 0; i < nseg; i++) {
      const lace = buf[off + 27 + i]!;
      partial.push(buf.subarray(p, p + lace));
      partialLen += lace;
      p += lace;
      if (partialLen > MAX_PACKET_BYTES) throw invalidOgg();
      if (lace < 255) {
        packets.push(Buffer.concat(partial));
        partial = [];
        partialLen = 0;
      }
    }
    off = end;
  }
  if (packets.length < 2) {
    if (packets.length === 1) parseOpusHead(packets[0]!);
    throw invalidOgg();
  }
  const head = packets[0]!;
  const { channels, preSkip } = parseOpusHead(head);
  if (packets[1]!.toString('latin1', 0, 8) !== 'OpusTags') throw invalidOgg();
  return { channels, preSkip, head, packets: packets.slice(2) };
}

function oggPage(
  flags: number,
  granule: number,
  serial: number,
  seq: number,
  packets: Buffer[],
): Buffer {
  const lacing: number[] = [];
  for (const pk of packets) {
    let n = pk.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  const h = Buffer.alloc(27 + lacing.length);
  h.write('OggS', 0, 'latin1');
  h[5] = flags;
  h.writeBigInt64LE(BigInt(granule), 6);
  h.writeUInt32LE(serial, 14);
  h.writeUInt32LE(seq, 18);
  h[26] = lacing.length;
  for (let i = 0; i < lacing.length; i++) h[27 + i] = lacing[i]!;
  const out = Buffer.concat([h, ...packets]);
  out.writeUInt32LE(oggCrc(out), 22);
  return out;
}

function laceCount(p: Buffer): number {
  return Math.floor(p.length / 255) + 1;
}

/** Writes an OGG/Opus file (RFC 7845): head page, tags page, audio pages of about one second. */
export function writeOggOpus(s: OpusStream, serial = 0x45_5a_43_4c): Buffer {
  const pages = [
    oggPage(0x02, 0, serial, 0, [s.head]),
    oggPage(0, 0, serial, 1, [buildOpusTags()]),
  ];
  let seq = 2;
  let granule = 0;
  let page: Buffer[] = [];
  let segs = 0;
  let pageSamples = 0;
  const flush = (last: boolean) => {
    pages.push(oggPage(last ? 0x04 : 0, granule, serial, seq++, page));
    page = [];
    segs = 0;
    pageSamples = 0;
  };
  for (const p of s.packets) {
    const n = laceCount(p);
    if (page.length && (segs + n > 255 || pageSamples >= OPUS_RATE)) flush(false);
    page.push(p);
    segs += n;
    const samples = opusPacketSamples(p);
    pageSamples += samples;
    granule += samples;
  }
  if (page.length) flush(true);
  return Buffer.concat(pages);
}

// ------------------------------------------------------------------ WebM (EBML)

const EBML_MAGIC = 0x1a45dfa3;
/** Master elements whose children are read in place (works for live, unknown-size elements). */
const DESCEND = new Set([
  0x18538067, // Segment
  0x1654ae6b, // Tracks
  0xae, // TrackEntry
  0xe1, // Audio
  0x1f43b675, // Cluster
  0xa0, // BlockGroup
]);

function readId(buf: Buffer, off: number): { id: number; len: number } | null {
  const first = buf[off];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || off + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[off + i]!;
  return { id, len };
}

/** EBML variable-size integer; `value` is null for the reserved "unknown size". */
function readVint(buf: Buffer, off: number): { value: number | null; len: number } | null {
  const first = buf[off];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (!(first & (0x80 >> (len - 1)))) len++;
  if (off + len > buf.length) return null;
  let value = first & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    const b = buf[off + i]!;
    if (b !== 0xff) allOnes = false;
    value = value * 256 + b;
  }
  return { value: allOnes ? null : value, len };
}

function readUint(data: Buffer): number {
  let v = 0;
  for (const b of data) v = v * 256 + b;
  return v;
}

interface WebmTrack {
  number?: number;
  type?: number;
  codec?: string;
  codecPrivate?: Buffer;
  codecDelayNs?: number;
  channels?: number;
}

const invalidWebm = () => new VoiceNoteError('Invalid WebM voice note');

/** Extracts the Opus audio track of a WebM recording (MediaRecorder output: SimpleBlocks, no lacing). */
export function readWebmOpus(buf: Buffer): OpusStream {
  const tracks: WebmTrack[] = [];
  const blocks: Array<{ track: number; data: Buffer }> = [];
  let current: WebmTrack | null = null;
  let off = 0;
  while (off < buf.length) {
    const id = readId(buf, off);
    if (!id) break; // trailing bytes of a cut-off recording
    const size = readVint(buf, off + id.len);
    if (!size) break;
    const dataStart = off + id.len + size.len;
    if (DESCEND.has(id.id)) {
      if (id.id === 0xae) {
        current = {};
        tracks.push(current);
      }
      off = dataStart;
      continue;
    }
    if (size.value === null) throw invalidWebm();
    const end = dataStart + size.value;
    if (end > buf.length) break; // the last block was cut off mid-write
    const data = buf.subarray(dataStart, end);
    switch (id.id) {
      case 0xd7:
        if (current) current.number = readUint(data);
        break;
      case 0x83:
        if (current) current.type = readUint(data);
        break;
      case 0x86:
        if (current) current.codec = data.toString('latin1');
        break;
      case 0x63a2:
        if (current) current.codecPrivate = Buffer.from(data);
        break;
      case 0x56aa:
        if (current) current.codecDelayNs = readUint(data);
        break;
      case 0x9f:
        if (current) current.channels = readUint(data);
        break;
      case 0xa3: // SimpleBlock
      case 0xa1: {
        // Block
        const tn = readVint(data, 0);
        if (!tn || tn.value === null || data.length < tn.len + 3) throw invalidWebm();
        const flags = data[tn.len + 2]!;
        if ((flags >> 1) & 3) throw new VoiceNoteError('Unsupported WebM lacing in voice note');
        blocks.push({ track: tn.value, data: Buffer.from(data.subarray(tn.len + 3)) });
        break;
      }
      default:
        break;
    }
    off = end;
  }
  if (!tracks.length) throw invalidWebm();
  const audio = tracks.find((t) => t.type === 2) ?? (tracks.length === 1 ? tracks[0] : undefined);
  if (!audio || audio.codec !== 'A_OPUS') throw new VoiceNoteError('Voice note is not Opus audio');
  let head: Buffer;
  let channels: number;
  let preSkip: number;
  if (audio.codecPrivate?.length) {
    head = audio.codecPrivate;
    ({ channels, preSkip } = parseOpusHead(head));
  } else {
    channels = audio.channels ?? 1;
    if (channels < 1 || channels > 2) {
      throw new VoiceNoteError('Voice note must be mono or stereo Opus audio');
    }
    preSkip =
      audio.codecDelayNs !== undefined
        ? Math.round((audio.codecDelayNs * OPUS_RATE) / 1e9)
        : DEFAULT_PRE_SKIP;
    head = buildOpusHead(channels, preSkip);
  }
  const trackNo = audio.number ?? 1;
  const packets = blocks.filter((b) => b.track === trackNo).map((b) => b.data);
  return { channels, preSkip, head, packets };
}

// ------------------------------------------------------------------ public

function streamSeconds(s: OpusStream): number {
  let samples = 0;
  for (const p of s.packets) samples += opusPacketSamples(p);
  return Math.max(0, samples - s.preSkip) / OPUS_RATE;
}

/** Playback length of a stored OGG/Opus voice note. */
export function voiceNoteSeconds(ogg: Buffer): number {
  return streamSeconds(readOggOpus(ogg));
}

/**
 * Validates a browser recording (OGG/Opus or WebM/Opus, mono or stereo, at most five minutes) and
 * returns it as a normalised OGG/Opus file. Throws VoiceNoteError for anything else.
 */
export function prepareVoiceNote(buf: Buffer): VoiceNote {
  let stream: OpusStream;
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS') stream = readOggOpus(buf);
  else if (buf.length >= 4 && buf.readUInt32BE(0) === EBML_MAGIC) stream = readWebmOpus(buf);
  else throw new VoiceNoteError('Voice note must be OGG/Opus or WebM/Opus audio');
  if (!stream.packets.length) throw new VoiceNoteError('Voice note is empty');
  for (const p of stream.packets) {
    if (p.length > MAX_PACKET_BYTES)
      throw new VoiceNoteError('Voice note contains an invalid Opus packet');
  }
  const seconds = streamSeconds(stream);
  if (seconds > VOICE_NOTE_MAX_SECONDS + VOICE_NOTE_TOLERANCE_SECONDS) {
    throw new VoiceNoteError('Voice note is longer than 5 minutes');
  }
  return { ogg: writeOggOpus(stream), seconds, channels: stream.channels };
}

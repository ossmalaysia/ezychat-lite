/**
 * Independent builders for voice-note test fixtures: Opus packets, Chrome-style WebM/Opus
 * (unknown-size Segment and Clusters) and Firefox-style OGG/Opus. They deliberately do not reuse
 * the production muxer, so tests check the server against separately written containers.
 */

/** One CELT full-band 20 ms Opus frame (TOC 0xF8) followed by `bytes` filler bytes. */
export function opus20ms(bytes = 3, fill = 0x11): Buffer {
  return Buffer.concat([Buffer.from([0xf8]), Buffer.alloc(bytes, fill)]);
}

/** One code-3 packet of six 20 ms frames (120 ms, the Opus maximum). */
export function opus120ms(bytes = 6): Buffer {
  return Buffer.concat([Buffer.from([0xfb, 0x06]), Buffer.alloc(bytes, 0x22)]);
}

/** `seconds` of 120 ms packets. */
export function opusPackets(seconds: number, packet = opus120ms): Buffer[] {
  return Array.from({ length: Math.round(seconds / 0.12) }, () => packet());
}

export function opusHead(channels = 1, preSkip = 312): Buffer {
  const b = Buffer.alloc(19);
  b.write('OpusHead', 0, 'latin1');
  b[8] = 1;
  b[9] = channels;
  b.writeUInt16LE(preSkip, 10);
  b.writeUInt32LE(48_000, 12);
  b.writeInt16LE(0, 16);
  b[18] = 0;
  return b;
}

function opusTags(): Buffer {
  const vendor = Buffer.from('fixture', 'latin1');
  const b = Buffer.alloc(8 + 4 + vendor.length + 4);
  b.write('OpusTags', 0, 'latin1');
  b.writeUInt32LE(vendor.length, 8);
  vendor.copy(b, 12);
  b.writeUInt32LE(0, 12 + vendor.length);
  return b;
}

// ------------------------------------------------------------------ EBML / WebM

function vintSize(n: number): Buffer {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const b = Buffer.alloc(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        b[i] = v % 256;
        v = Math.floor(v / 256);
      }
      b[0]! |= 1 << (8 - len);
      return b;
    }
  }
  throw new Error('size too large');
}

const UNKNOWN_SIZE = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

function idBytes(id: number): Buffer {
  const hex = id.toString(16);
  return Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
}

function el(id: number, data: Buffer, unknown = false): Buffer {
  return Buffer.concat([idBytes(id), unknown ? UNKNOWN_SIZE : vintSize(data.length), data]);
}

function uint(id: number, v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v);
  return el(id, b);
}

function str(id: number, v: string): Buffer {
  return el(id, Buffer.from(v, 'latin1'));
}

export interface WebmOptions {
  channels?: number;
  codecId?: string;
  /** include an OpusHead as CodecPrivate (Chrome does) */
  codecPrivate?: boolean;
  /** EBML lacing flag on every SimpleBlock (Chrome never laces audio) */
  laced?: boolean;
  /** a video track before the audio track */
  withVideoTrack?: boolean;
}

/** Chrome MediaRecorder-style WebM: live (unknown-size) Segment and Clusters of SimpleBlocks. */
export function webmOpus(packets: Buffer[], o: WebmOptions = {}): Buffer {
  const channels = o.channels ?? 1;
  const header = el(
    0x1a45dfa3,
    Buffer.concat([uint(0x4286, 1), uint(0x42f7, 1), str(0x4282, 'webm'), uint(0x4287, 4)]),
  );
  const audioTrack = el(
    0xae,
    Buffer.concat([
      uint(0xd7, o.withVideoTrack ? 2 : 1),
      uint(0x83, 2),
      str(0x86, o.codecId ?? 'A_OPUS'),
      ...(o.codecPrivate === false ? [] : [el(0x63a2, opusHead(channels))]),
      el(0xe1, Buffer.concat([uint(0x9f, channels)])),
    ]),
  );
  const videoTrack = el(0xae, Buffer.concat([uint(0xd7, 1), uint(0x83, 1), str(0x86, 'V_VP8')]));
  const tracks = el(
    0x1654ae6b,
    Buffer.concat([...(o.withVideoTrack ? [videoTrack] : []), audioTrack]),
  );
  const info = el(0x1549a966, Buffer.concat([uint(0x2ad7b1, 1_000_000), str(0x4d80, 'fixture')]));
  const trackNo = o.withVideoTrack ? 0x82 : 0x81;
  const clusters: Buffer[] = [];
  const perCluster = 50;
  for (let i = 0; i < packets.length; i += perCluster) {
    const blocks = packets.slice(i, i + perCluster).map((p, j) => {
      const head = Buffer.from([trackNo, 0, 0, o.laced ? 0x86 : 0x80]);
      head.writeInt16BE(j * 20, 1);
      return el(0xa3, Buffer.concat([head, p]));
    });
    if (o.withVideoTrack) blocks.push(el(0xa3, Buffer.from([0x81, 0, 0, 0x80, 1, 2, 3])));
    clusters.push(el(0x1f43b675, Buffer.concat([uint(0xe7, i * 20), ...blocks]), true));
  }
  const segment = el(0x18538067, Buffer.concat([info, tracks, ...clusters]), true);
  return Buffer.concat([header, segment]);
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

function crc(buf: Buffer): number {
  let c = 0;
  for (const b of buf) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ b) & 0xff]!) >>> 0;
  return c;
}

function page(
  flags: number,
  granule: bigint,
  serial: number,
  seq: number,
  packets: Buffer[],
): Buffer {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  const h = Buffer.alloc(27 + lacing.length);
  h.write('OggS', 0, 'latin1');
  h[4] = 0;
  h[5] = flags;
  h.writeBigInt64LE(granule, 6);
  h.writeUInt32LE(serial, 14);
  h.writeUInt32LE(seq, 18);
  h[26] = lacing.length;
  Buffer.from(lacing).copy(h, 27);
  const out = Buffer.concat([h, ...packets]);
  out.writeUInt32LE(crc(out), 22);
  return out;
}

export interface OggOptions {
  channels?: number;
  /** replace the OpusHead packet (e.g. a Vorbis identification header) */
  firstPacket?: Buffer;
  serial?: number;
}

/** Firefox MediaRecorder-style OGG/Opus: head page, tags page, then 10 packets per page. */
export function oggOpus(packets: Buffer[], o: OggOptions = {}): Buffer {
  const serial = o.serial ?? 0x1234;
  const pages = [
    page(0x02, 0n, serial, 0, [o.firstPacket ?? opusHead(o.channels ?? 1)]),
    page(0x00, 0n, serial, 1, [opusTags()]),
  ];
  let granule = 0n;
  for (let i = 0, seq = 2; i < packets.length; i += 10, seq++) {
    const chunk = packets.slice(i, i + 10);
    for (const p of chunk) granule += BigInt(p[0] === 0xfb ? 5760 : 960);
    const last = i + 10 >= packets.length;
    pages.push(page(last ? 0x04 : 0x00, granule, serial, seq, chunk));
  }
  return Buffer.concat(pages);
}

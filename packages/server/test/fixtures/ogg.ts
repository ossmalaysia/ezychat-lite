// Builds crafted Ogg/Opus voice notes for tests (sender-controlled headers that lie about length).

/** One Ogg page holding whole packets (each under 255 bytes), CRC left zero (not checked here). */
function oggPage(serial: number, flags: number, granule: bigint, packets: number[][]): number[] {
  const header = new Uint8Array(27);
  const view = new DataView(header.buffer);
  header.set([0x4f, 0x67, 0x67, 0x53]);
  header[5] = flags;
  view.setBigInt64(6, granule, true);
  view.setUint32(14, serial, true);
  header[26] = packets.length;
  return [...header, ...packets.map((packet) => packet.length), ...packets.flat()];
}

const opusHead = (channels: number) => [
  ...Array.from('OpusHead', (c) => c.charCodeAt(0)),
  1,
  channels,
  0x38,
  0x01, // pre-skip 312
  0x80,
  0xbb,
  0,
  0, // 48 kHz
  0,
  0,
  0,
];
const opusTags = Array.from('OpusTags', (c) => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0]);
/** CELT 2.5 ms frames (config 16), code 3 with 48 frames: 120 ms of audio in 2 bytes. */
const LONG_PACKET = [(16 << 3) | 3, 48];

/** A voice note whose granule positions claim 20 ms while its packets hold `pages` × 30.6 s. */
export function craftedNote(pages: number, channels = 1, extraStream = false): Uint8Array {
  const bytes = [...oggPage(7, 0x02, 0n, [opusHead(channels)]), ...oggPage(7, 0, 0n, [opusTags])];
  for (let i = 0; i < pages; i++)
    bytes.push(
      ...oggPage(
        7,
        0,
        960n,
        Array.from({ length: 255 }, () => LONG_PACKET),
      ),
    );
  if (extraStream) bytes.push(...oggPage(8, 0x02, 0n, [opusHead(1)]));
  return new Uint8Array(bytes);
}

/** CELT 2.5 ms, one frame (config 16, code 0): the short TOC a crafted fragment advertises. */
const SHORT_TOC = 16 << 3;

/**
 * Pairs of pages: an unterminated 255-byte packet whose TOC claims 2.5 ms, then a page that does
 * not continue it (a demuxer drops the fragment) holding a real 120 ms packet. Joining the two
 * would count only 2.5 ms per pair.
 */
export function smuggledNote(pairs: number): Uint8Array {
  const fragment = [SHORT_TOC, ...new Array<number>(254).fill(0)];
  const bytes = [...oggPage(7, 0x02, 0n, [opusHead(1)]), ...oggPage(7, 0, 0n, [opusTags])];
  for (let i = 0; i < pairs; i++)
    bytes.push(...oggPage(7, 0, -1n, [fragment]), ...oggPage(7, 0, 960n, [LONG_PACKET]));
  return new Uint8Array(bytes);
}

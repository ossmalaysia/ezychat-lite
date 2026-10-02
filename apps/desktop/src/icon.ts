// Generates the app/tray icon as a PNG buffer (no binary assets needed). Pure Node.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encodes RGBA pixels as PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Emerald rounded square with a white speech bubble (not WhatsApp branding).
 * `monochrome` draws a black glyph for macOS template tray images.
 */
export function iconPng(size: number, opts: { monochrome?: boolean } = {}): Buffer {
  const px = new Uint8Array(size * size * 4);
  const SS = 4; // supersampling
  const bg = opts.monochrome ? [0, 0, 0] : [5, 150, 105]; // #059669
  const fg = opts.monochrome ? null : [255, 255, 255];
  const inside = (u: number, v: number): 'bg' | 'fg' | null => {
    // u,v in [0,1]
    const r = 0.22;
    const cx = Math.min(Math.max(u, r), 1 - r);
    const cy = Math.min(Math.max(v, r), 1 - r);
    const inSquare = (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
    if (opts.monochrome) {
      // bubble only (template image)
      return inBubble(u, v) ? 'bg' : null;
    }
    if (!inSquare) return null;
    return inBubble(u, v) ? 'fg' : 'bg';
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      let f = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const hit = inside((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          if (hit) a++;
          if (hit === 'fg') f++;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      const fr = a ? f / a : 0;
      const col = fg ? bg.map((c, k) => Math.round(c * (1 - fr) + (fg[k] ?? 0) * fr)) : bg;
      px[i] = col[0] ?? 0;
      px[i + 1] = col[1] ?? 0;
      px[i + 2] = col[2] ?? 0;
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, size, px);
}

function inBubble(u: number, v: number): boolean {
  // ellipse body
  const ex = (u - 0.5) / 0.3;
  const ey = (v - 0.46) / 0.24;
  if (ex * ex + ey * ey <= 1) return true;
  // tail: triangle bottom-left
  const ax = 0.3, ay = 0.62, bx = 0.44, by = 0.66, cx = 0.26, cy = 0.8;
  const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  const l1 = ((bx - u) * (cy - v) - (cx - u) * (by - v)) / d;
  const l2 = ((cx - u) * (ay - v) - (ax - u) * (cy - v)) / d;
  const l3 = 1 - l1 - l2;
  return l1 >= 0 && l2 >= 0 && l3 >= 0;
}

/** The app's own chat preview of an image: long side in pixels and JPEG quality (sharp on a 2x screen). */
export const PREVIEW_MAX_SIDE = 800;
export const PREVIEW_QUALITY = 75;
/** Files above this are not decoded for a preview; the chat keeps WhatsApp's thumbnail or the file. */
export const PREVIEW_MAX_FILE_BYTES = 15 * 1024 * 1024;
/**
 * Decoder limits per worker (2 run at once): a hostile JPEG header cannot make one allocate more.
 * WhatsApp's largest (HD) photo is 4096 × 3072, about 12.6 MP.
 */
export const PREVIEW_MAX_MEGAPIXELS = 24;
export const PREVIEW_MAX_DECODE_MB = 128;

/** A JPEG starts with FF D8 FF; only JPEGs get a preview (WhatsApp sends photos as JPEG). */
export function isJpeg(buf: Uint8Array): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * The EXIF Orientation of a JPEG (1 = upright, also when there is no EXIF). Reads only the APP1
 * segment's first directory; anything malformed counts as upright.
 */
export function jpegOrientation(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 2;
  while (p + 4 <= buf.length && buf[p] === 0xff) {
    const marker = buf[p + 1]!;
    const length = view.getUint16(p + 2);
    // Start of scan: no EXIF before the image data.
    if (marker === 0xda || length < 2) return 1;
    const exif = p + 4;
    if (marker === 0xe1 && exif + 14 <= buf.length && view.getUint32(exif) === 0x45786966) {
      const tiff = exif + 6;
      const little = view.getUint16(tiff) === 0x4949;
      const u16 = (at: number) => view.getUint16(at, little);
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > buf.length) return 1;
      const entries = u16(ifd);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 > buf.length) return 1;
        if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
      }
      return 1;
    }
    p += 2 + length;
  }
  return 1;
}

/** The preview size for an image of `width` × `height`: never larger than the image itself. */
export function previewSize(width: number, height: number, maxSide = PREVIEW_MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Shrinks RGBA pixels to fit `maxSide` by averaging each target pixel's source box (no blur from
 * sampling single pixels). Returns the input unchanged when it already fits.
 */
export function downscaleRgba(
  data: Uint8Array,
  width: number,
  height: number,
  maxSide = PREVIEW_MAX_SIDE,
): { data: Uint8Array; width: number; height: number } {
  const size = previewSize(width, height, maxSide);
  if (size.width === width && size.height === height) return { data, width, height };
  const out = new Uint8Array(size.width * size.height * 4);
  const sx = width / size.width;
  const sy = height / size.height;
  for (let y = 0; y < size.height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < size.width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          a += data[i + 3]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * size.width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { data: out, ...size };
}

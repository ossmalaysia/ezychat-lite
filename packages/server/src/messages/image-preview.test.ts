import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { makeImagePreview } from './image-preview.js';
import { downscaleRgba, isJpeg, jpegOrientation, previewSize } from './image-preview-scale.js';

const solid = (width: number, height: number, rgba: [number, number, number, number]) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return data;
};

/** A JPEG with an EXIF APP1 segment whose first directory holds Orientation = `value`. */
const withOrientation = (file: Buffer, value: number, little = false) => {
  const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) =>
    little
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
      : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1), // one entry
    ...u16(0x0112),
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(value),
    0,
    0,
    ...u32(0),
  ];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
  return Buffer.concat([file.subarray(0, 2), app1, file.subarray(2)]);
};

const dir = mkdtempSync(join(tmpdir(), 'image-preview-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const fileOf = (name: string, bytes: Buffer) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};
const photo = (width: number, height: number) =>
  Buffer.from(
    jpeg.encode({ data: solid(width, height, [200, 40, 40, 255]), width, height }, 90).data,
  );

describe('previewSize', () => {
  it('fits the long side to 800 px and keeps the shape', () => {
    expect(previewSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(previewSize(1080, 1920)).toEqual({ width: 450, height: 800 });
  });

  it('never makes an image larger', () => {
    expect(previewSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('keeps at least one pixel on a very thin image', () => {
    expect(previewSize(8000, 2)).toEqual({ width: 800, height: 1 });
  });
});

describe('downscaleRgba', () => {
  it('averages each box: a 2 x 1 black-and-white image becomes one grey pixel', () => {
    const data = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]);
    const out = downscaleRgba(data, 2, 1, 1);
    expect([out.width, out.height]).toEqual([1, 1]);
    expect(Array.from(out.data)).toEqual([128, 128, 128, 255]);
  });

  it('returns the same pixels when the image already fits', () => {
    const data = solid(4, 4, [1, 2, 3, 255]);
    expect(downscaleRgba(data, 4, 4, 800).data).toBe(data);
  });

  it('keeps a solid colour exact on a non-integer scale', () => {
    const out = downscaleRgba(solid(1000, 750, [10, 20, 30, 255]), 1000, 750);
    expect([out.width, out.height]).toEqual([800, 600]);
    expect(Array.from(out.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(out.data.slice(-4))).toEqual([10, 20, 30, 255]);
  });
});

describe('isJpeg', () => {
  it('reads the first bytes, not the name', () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0]))).toBe(true);
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]))).toBe(false);
    expect(isJpeg(Buffer.from([0xff, 0xd8]))).toBe(false);
  });
});

describe('jpegOrientation', () => {
  const plain = photo(8, 8);

  it('is upright without EXIF', () => {
    expect(jpegOrientation(plain)).toBe(1);
  });

  it('reads Orientation in both byte orders', () => {
    expect(jpegOrientation(withOrientation(plain, 6))).toBe(6);
    expect(jpegOrientation(withOrientation(plain, 3, true))).toBe(3);
    expect(jpegOrientation(withOrientation(plain, 1))).toBe(1);
  });

  it('counts a cut-off or malformed EXIF as upright', () => {
    const exif = withOrientation(plain, 6);
    expect(jpegOrientation(exif.subarray(0, 20))).toBe(1);
    expect(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 1]))).toBe(1);
  });
});

describe('makeImagePreview (worker thread)', () => {
  it('turns a large photo into an 800 px JPEG', async () => {
    const out = await makeImagePreview(fileOf('big.jpg', photo(1200, 1600)));
    expect(out).not.toBeNull();
    const img = jpeg.decode(out!);
    expect([img.width, img.height]).toEqual([600, 800]);
  });

  it('answers null for a file that is not a JPEG', async () => {
    expect(
      await makeImagePreview(fileOf('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]))),
    ).toBeNull();
  });

  it('answers null for a broken JPEG', async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    expect(await makeImagePreview(fileOf('broken.jpg', broken))).toBeNull();
  });

  it('answers null for a photo EXIF turns sideways: the chat shows the file itself', async () => {
    expect(
      await makeImagePreview(fileOf('side.jpg', withOrientation(photo(40, 30), 6))),
    ).toBeNull();
  });

  it('answers null for a file that is gone', async () => {
    expect(await makeImagePreview(join(dir, 'missing.jpg'))).toBeNull();
  });
});

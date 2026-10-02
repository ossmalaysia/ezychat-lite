import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { iconPng } from './icon.js';

describe('iconPng', () => {
  it('produces a valid RGBA PNG of the requested size', () => {
    const png = iconPng(32);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
    const idatLen = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((32 * 4 + 1) * 32);
    // corners transparent, centre opaque
    expect(raw[1 + 3]).toBe(0);
    const mid = 16 * (32 * 4 + 1) + 1 + 16 * 4;
    expect(raw[mid + 3]).toBe(255);
  });
});

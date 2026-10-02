#!/usr/bin/env node
/**
 * generate-icons.mjs — builds the "WA Team Inbox" icon set from a single
 * 1024x1024 source PNG (teal rounded square, white inbox tray + chat bubble).
 *
 * sharp / png-to-ico are intentionally NOT repo dependencies. Install them in a
 * throwaway directory and point ICONGEN_MODULES at its node_modules:
 *
 *   mkdir /tmp/icongen && cd /tmp/icongen && npm init -y && npm i sharp png-to-ico
 *   ICONGEN_MODULES=/tmp/icongen/node_modules \
 *     node scripts/generate-icons.mjs path/to/icon-1024.png
 *
 * Source defaults to docs/brand/icon-source-1024.png (or ICON_SOURCE env).
 * See docs/brand.md for the list of outputs.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODS = process.env.ICONGEN_MODULES;
if (!MODS) {
  console.error('Set ICONGEN_MODULES to a node_modules dir containing sharp and png-to-ico.');
  process.exit(1);
}
const req = createRequire(join(MODS, '_icongen.cjs'));
const sharp = req('sharp');
const pngToIco = (await import(pathToFileURL(join(MODS, 'png-to-ico', 'index.js')).href)).default;

const SRC = resolve(process.argv[2] || process.env.ICON_SOURCE || join(ROOT, 'docs/brand/icon-source-1024.png'));
const TEAL = '#0F766E';
const N = 1024;
// The draft's visible corner fits a radius of ~185px; 192 (~19%) trims the white fringe.
const RADIUS = 192;
// Glyph (tray + bubble) bounding box in the draft is ~x183..840, y213..809.
const GLYPH_CROP = { left: 162, top: 161, width: 700, height: 700 }; // square, glyph-centred

const out = (p) => {
  const abs = join(ROOT, p);
  mkdirSync(dirname(abs), { recursive: true });
  return abs;
};
const write = (p, buf) => {
  writeFileSync(out(p), buf);
  console.log('wrote', p);
};

const roundedMask = (size, r) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );

const srcRgb = await sharp(SRC).resize(N, N).removeAlpha().raw().toBuffer();
const maskA = await sharp(roundedMask(N, RADIUS)).extractChannel(3).raw().toBuffer();

// 1. Transparent master (rounded-rect alpha mask over the draft).
const masterRaw = Buffer.alloc(N * N * 4);
for (let i = 0; i < N * N; i++) {
  srcRgb.copy(masterRaw, i * 4, i * 3, i * 3 + 3);
  masterRaw[i * 4 + 3] = maskA[i];
}
const master = await sharp(masterRaw, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();

/**
 * Glyph layer: solid `rgb` with alpha = whiteness of the draft inside GLYPH_CROP.
 * Red channel is ~0-30 on the teal background and ~255 on the white glyph.
 */
async function glyphLayer(glyphSize, rgb) {
  const { left, top, width, height } = GLYPH_CROP;
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = srcRgb[((top + y) * N + left + x) * 3];
      const o = (y * width + x) * 4;
      px[o] = rgb.r;
      px[o + 1] = rgb.g;
      px[o + 2] = rgb.b;
      px[o + 3] = Math.max(0, Math.min(255, Math.round(((r - 80) * 255) / 170)));
    }
  }
  return sharp(px, { raw: { width, height, channels: 4 } })
    .resize(glyphSize, glyphSize, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

/** Glyph centred on a canvas (bg = color or transparent). glyphFrac = crop-square size / canvas. */
async function glyphOn(size, glyphFrac, bg, rgb) {
  const g = Math.round(size * glyphFrac);
  const off = Math.round((size - g) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: await glyphLayer(g, rgb), left: off, top: off }])
    .png()
    .toBuffer();
}

const resized = (s) => sharp(master).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer();
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// Desktop master + ico
write('apps/desktop/build/icon.png', master);
write(
  'apps/desktop/build/icon.ico',
  await pngToIco(await Promise.all([16, 24, 32, 48, 64, 128, 256].map(resized))),
);

// Web
write('apps/web/public/icon-192.png', await resized(192));
write('apps/web/public/icon-512.png', await resized(512));
// Apple touch: opaque, iOS applies its own corner mask. Crop square = 700/1024 of canvas, like the draft.
write('apps/web/public/apple-touch-icon.png', await sharp(await glyphOn(180, 700 / 1024, TEAL, WHITE)).flatten({ background: TEAL }).png().toBuffer());
// Maskable: full-bleed teal, glyph (~0.64 of crop square) kept well inside the 80% safe circle.
write('apps/web/public/icon-maskable-512.png', await sharp(await glyphOn(512, 0.58, TEAL, WHITE)).flatten({ background: TEAL }).png().toBuffer());
write('apps/web/public/favicon.ico', await pngToIco(await Promise.all([16, 32, 48].map(resized))));

// Tray: macOS template (black glyph on transparent) + colored icon for Windows/Linux.
write('apps/desktop/build/tray/trayTemplate.png', await glyphOn(22, 1, CLEAR, BLACK));
write('apps/desktop/build/tray/trayTemplate@2x.png', await glyphOn(44, 1, CLEAR, BLACK));
write('apps/desktop/build/tray/tray.png', await resized(16));
write('apps/desktop/build/tray/tray@2x.png', await resized(32));

console.log('done');

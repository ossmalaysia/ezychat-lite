import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { precompressWeb } from './precompress-web.mjs';

let directory;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('compresses nested public text losslessly with stable timestamps and no redundant variants', async () => {
  directory = await mkdtemp(join(tmpdir(), 'wati-precompress-'));
  const assets = join(directory, 'assets');
  await mkdir(assets);
  const original = Buffer.from('export const greeting = "hello world";\n'.repeat(100));
  const script = join(assets, 'app-hash.js');
  await writeFile(script, original);
  const timestamp = new Date('2026-01-01T00:00:00Z');
  await utimes(script, timestamp, timestamp);
  await writeFile(join(directory, 'small.svg'), '<svg/>');
  await writeFile(join(directory, 'image.png'), original);
  const uncompressible = randomBytes(2048);
  await writeFile(join(directory, 'noise.json'), uncompressible);
  await precompressWeb(directory);
  expect(await readFile(script)).toEqual(original);
  for (const [extension, decode] of [
    ['gz', gunzipSync],
    ['br', brotliDecompressSync],
  ]) {
    const encoded = await readFile(`${script}.${extension}`);
    expect(decode(encoded)).toEqual(original);
    expect(encoded.length).toBeLessThan(original.length);
    expect((await stat(`${script}.${extension}`)).mtimeMs).toBe(timestamp.getTime());
  }
  expect((await readdir(directory)).sort()).toEqual([
    'assets',
    'image.png',
    'noise.json',
    'small.svg',
  ]);
  await precompressWeb(directory);
  expect((await readdir(assets)).sort()).toEqual([
    'app-hash.js',
    'app-hash.js.br',
    'app-hash.js.gz',
  ]);
  await writeFile(script, 'small again');
  await precompressWeb(directory);
  expect(await readdir(assets)).toEqual(['app-hash.js']);
});

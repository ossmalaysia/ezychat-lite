// Public build assets only: compress once during the build, never customer/API responses.
import { readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const encoders = [
  ['gz', promisify(gzip), { level: 9 }],
  ['br', promisify(brotliCompress), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }],
];
const textExtensions = new Set(['.js', '.css', '.html', '.svg', '.webmanifest', '.json']);

export async function precompressWeb(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await precompressWeb(path);
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      const info = await stat(path);
      const source = info.size >= 1024 ? await readFile(path) : null;
      for (const [extension, encode, options] of encoders) {
        const output = `${path}.${extension}`;
        const encoded = source ? await encode(source, options) : null;
        if (!encoded || encoded.length >= source.length) {
          await rm(output, { force: true });
          continue;
        }
        await writeFile(output, encoded);
        // Static validators stay consistent across repeat requests and repeated builds.
        await utimes(output, info.atime, info.mtime);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await precompressWeb(fileURLToPath(new URL('../apps/web/dist/', import.meta.url)));
}

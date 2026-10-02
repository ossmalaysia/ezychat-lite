import { ZipArchive } from 'archiver';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function logsDir(dataDir: string): string {
  return join(dataDir, 'logs');
}

/**
 * Streams a zip of every regular file in `<data>/logs` (an empty zip when the dir is missing).
 * The returned archive is a readable stream; finalize() is already called.
 */
export function zipLogs(dataDir: string): ZipArchive {
  const zip = new ZipArchive({ zlib: { level: 9 } });
  const dir = logsDir(dataDir);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try {
        if (statSync(file).isFile()) zip.file(file, { name });
      } catch {
        // file rotated away between readdir and stat
      }
    }
  }
  void zip.finalize().catch(() => undefined);
  return zip;
}

import { ZipArchive } from 'archiver';
import { createReadStream, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { redactLogLine } from '../log-redaction.js';

export function logsDir(dataDir: string): string {
  return join(dataDir, 'logs');
}

/**
 * Streams redacted JSON records from regular log files (an empty zip when the dir is missing).
 * The returned archive is a readable stream; finalize() is already called.
 */
export function zipLogs(dataDir: string): ZipArchive {
  const zip = new ZipArchive({ zlib: { level: 9 } });
  const dir = logsDir(dataDir);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try {
        if (lstatSync(file).isFile()) {
          zip.append(Readable.from(redactedLines(file)), { name });
        }
      } catch {
        // file rotated away between readdir and stat
      }
    }
  }
  void zip.finalize().catch(() => undefined);
  return zip;
}

async function* redactedLines(file: string): AsyncGenerator<string> {
  const input = createReadStream(file);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield redactLogLine(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

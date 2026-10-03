import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { zipLogs } from './logs.js';

let dataDir: string | undefined;
afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

it('redacts existing log secrets in the actual ZIP stream without rewriting local logs', async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'wati-log-export-'));
  mkdirSync(join(dataDir, 'logs'));
  const file = join(dataDir, 'logs', 'old.log');
  const original = [
    JSON.stringify({
      mod: 'wa',
      msg: 'history',
      histNotification: { mediaKey: 'secret-media', timestamp: 123 },
      nested: [{ deeper: { Credentials: { privateKey: 'secret-private' } } }],
      req: { headers: { Authorization: 'secret-auth', cookie: 'secret-cookie' } },
    }),
    '{"token":"secret-incomplete"',
    'secret-unstructured',
  ].join('\n');
  writeFileSync(file, original);
  const chunks: Buffer[] = [];
  for await (const chunk of zipLogs(dataDir)) chunks.push(Buffer.from(chunk));
  const zip = Buffer.concat(chunks);
  // Read this single entry using ZIP's central-directory size (streamed entries use descriptors).
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  expect(zip.readUInt16LE(end + 10)).toBe(1);
  const central = zip.readUInt32LE(end + 16);
  expect(zip.readUInt16LE(central + 10)).toBe(8); // Deflate
  const local = zip.readUInt32LE(central + 42);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const exported = inflateRawSync(
    zip.subarray(start, start + zip.readUInt32LE(central + 20)),
  ).toString();
  expect(exported).not.toContain('secret-');
  const records = exported
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(records[0]).toMatchObject({
    mod: 'wa',
    msg: 'history',
    histNotification: { mediaKey: '[REDACTED]', timestamp: 123 },
    nested: [{ deeper: { Credentials: { privateKey: '[REDACTED]' } } }],
  });
  expect(records[1].msg).toContain('omitted');
  expect(records[2].msg).toContain('omitted');
  expect(readFileSync(file, 'utf8')).toBe(original);
});

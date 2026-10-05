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

function writeLog(lines: string[]) {
  dataDir = mkdtempSync(join(tmpdir(), 'wati-log-export-'));
  mkdirSync(join(dataDir, 'logs'));
  const file = join(dataDir, 'logs', 'old.log');
  const original = lines.join('\n');
  writeFileSync(file, original);
  return { file, original };
}

/** Reads the single entry using ZIP's central-directory size (streamed entries use descriptors). */
async function exportedText(dir: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of zipLogs(dir)) chunks.push(Buffer.from(chunk));
  const zip = Buffer.concat(chunks);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  expect(zip.readUInt16LE(end + 10)).toBe(1);
  const central = zip.readUInt32LE(end + 16);
  expect(zip.readUInt16LE(central + 10)).toBe(8); // Deflate
  const local = zip.readUInt32LE(central + 42);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  return inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(central + 20))).toString();
}

it('redacts existing log secrets in the actual ZIP stream without rewriting local logs', async () => {
  const { file, original } = writeLog([
    JSON.stringify({
      mod: 'wa',
      msg: 'history',
      histNotification: { mediaKey: 'secret-media', timestamp: 123 },
      nested: [{ deeper: { Credentials: { privateKey: 'secret-private' } } }],
      req: { headers: { Authorization: 'secret-auth', cookie: 'secret-cookie' } },
    }),
    '{"token":"secret-incomplete"',
    'secret-unstructured',
  ]);
  const exported = await exportedText(dataDir!);
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

it('redacts ChatGPT sign-in secrets that older builds wrote to the log', async () => {
  writeLog([
    JSON.stringify({
      mod: 'ai',
      msg: 'callback http://localhost:1455/auth/callback?code=secret-code&state=secret-state',
      access_token: 'secret-access',
      nested: {
        refresh_token: 'secret-refresh',
        link: 'https://auth.openai.com/oauth/authorize?state=secret-authz&code_challenge=secret-challenge',
        header: 'Bearer secret-bearer',
      },
    }),
  ]);
  const exported = await exportedText(dataDir!);
  expect(exported).not.toContain('secret-');
  const record = JSON.parse(exported.trim());
  expect(record.mod).toBe('ai');
  expect(record.msg).toBe('callback http://localhost:1455/auth/callback?[REDACTED]');
  expect(record.nested.link).toBe('https://auth.openai.com/oauth/authorize?[REDACTED]');
  expect(record.nested.header).toBe('Bearer [REDACTED]');
});

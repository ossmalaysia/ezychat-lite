#!/usr/bin/env node
// Downloads the pinned WinSW release (Windows service wrapper) into resources/winsw/WinSW-x64.exe
// and verifies its SHA-256. Usage: node scripts/fetch-winsw.mjs [--force]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINSW_VERSION = '2.12.0';
const URL_X64 = `https://github.com/winsw/winsw/releases/download/v${WINSW_VERSION}/WinSW-x64.exe`;
const SHA256_X64 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'resources', 'winsw', 'WinSW-x64.exe');
const force = process.argv.includes('--force');

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'wa-team-inbox-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`  download failed (${err.message}); retrying…`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

try {
  if (!force && existsSync(out) && sha(readFileSync(out)) === SHA256_X64) {
    console.log(`WinSW ${WINSW_VERSION}: up to date`);
  } else {
    console.log(`WinSW ${WINSW_VERSION}: downloading WinSW-x64.exe`);
    const buf = await download(URL_X64);
    const digest = sha(buf);
    if (digest !== SHA256_X64) throw new Error(`checksum mismatch: got ${digest}, expected ${SHA256_X64}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(`${out}.download`, buf);
    rmSync(out, { force: true });
    renameSync(`${out}.download`, out);
    console.log(`  -> ${out}`);
  }
} catch (err) {
  console.error(`fetch-winsw: ${err.message}`);
  process.exit(1);
}

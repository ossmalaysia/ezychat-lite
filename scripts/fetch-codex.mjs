#!/usr/bin/env node
// Official Codex app-server helper, pinned together with the restricted protocol/config.
// Every downloaded archive AND cached extracted binary is SHA-256 verified.
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { extractFromTar } from './fetch-cloudflared.mjs';

export const CODEX_VERSION = '0.114.0';
export const CODEX_LEGAL = {
  LICENSE: 'd17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc',
  NOTICE: 'f1472762614227ff6fb67e73fe42a9e5e80a0bcc7677158b1a7c3753a8a3a3e5',
};
export const CODEX_TARGETS = {
  'win32-x64': {
    asset: 'codex-x86_64-pc-windows-msvc.exe.tar.gz',
    sha256: '4fb0256f9297946b11fd4585d4ddcd0b7d1f2ce162bfcc0b6ccce9913714f290',
    archivedBinary: 'codex-x86_64-pc-windows-msvc.exe',
    binary: 'codex.exe',
  },
  'darwin-x64': {
    asset: 'codex-x86_64-apple-darwin.tar.gz',
    sha256: 'b0c7ce9f6e3693ecc150bc0cb95b4a1766d7b849747090e5077de8d4d2cac974',
    archivedBinary: 'codex-x86_64-apple-darwin',
    binary: 'codex',
  },
  'darwin-arm64': {
    asset: 'codex-aarch64-apple-darwin.tar.gz',
    sha256: 'c98eb550695f99eaec27df9971a1b76a83acb15eb55522383fa31b0497297c54',
    archivedBinary: 'codex-aarch64-apple-darwin',
    binary: 'codex',
  },
  'linux-x64': {
    asset: 'codex-x86_64-unknown-linux-musl.tar.gz',
    sha256: '9229de8c51c8ef30565bb507c97a2edc04a80b38e49a4363f337fe05bedf34eb',
    archivedBinary: 'codex-x86_64-unknown-linux-musl',
    binary: 'codex',
  },
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

export async function fetchCodexLegal(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [name, digest] of Object.entries(CODEX_LEGAL)) {
    const out = join(dir, name);
    if (existsSync(out) && hash(readFileSync(out)) === digest) continue;
    const response = await fetch(
      `https://raw.githubusercontent.com/openai/codex/rust-v${CODEX_VERSION}/${name}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new Error(`Codex ${name} download failed: HTTP ${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    if (hash(content) !== digest) throw new Error(`Checksum mismatch for Codex ${name}`);
    writeFileSync(out, content);
  }
}

export function verifiedCodexBinary(archive, target) {
  if (hash(archive) !== target.sha256) throw new Error(`Checksum mismatch for ${target.asset}`);
  return extractFromTar(gunzipSync(archive), target.archivedBinary);
}

export async function fetchCodexTarget(name, force = false, rootDir = root) {
  const target = CODEX_TARGETS[name];
  if (!target) throw new Error(`Unsupported Codex target: ${name}`);
  const dir = join(rootDir, 'resources', 'codex', name);
  const out = join(dir, target.binary);
  const archivePath = join(dir, target.asset);
  // Verify archive against a checked-in digest, then verify the installed executable matches
  // the archive. A version stamp alone does not establish cached executable integrity.
  if (!force && existsSync(archivePath)) {
    const binary = verifiedCodexBinary(readFileSync(archivePath), target);
    if (existsSync(out) && hash(readFileSync(out)) === hash(binary)) {
      await fetchCodexLegal(dir);
      console.log(`Codex ${CODEX_VERSION} ${name}: verified`);
      return;
    }
  }
  console.log(`Codex ${CODEX_VERSION} ${name}: downloading`);
  const url = `https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/${target.asset}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
    redirect: 'follow',
    headers: { 'user-agent': 'ezychat-lite-build' },
  });
  if (!response.ok) throw new Error(`Codex download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const binary = verifiedCodexBinary(archive, target);
  mkdirSync(dir, { recursive: true });
  writeFileSync(archivePath, archive);
  const temporary = `${out}.download`;
  writeFileSync(temporary, binary);
  if (!target.binary.endsWith('.exe')) chmodSync(temporary, 0o755);
  rmSync(out, { force: true });
  renameSync(temporary, out);
  writeFileSync(join(dir, 'codex.version'), `${CODEX_VERSION}\n`);
  await fetchCodexLegal(dir);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let force = false;
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') force = true;
    else if (args[i] === '--current') targets.push(`${process.platform}-${process.arch}`);
    else if (args[i] === '--target') targets.push(args[++i]);
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  try {
    for (const target of new Set(
      targets.length ? targets : ['win32-x64', 'darwin-x64', 'darwin-arm64'],
    ))
      await fetchCodexTarget(target, force);
  } catch (error) {
    console.error(`fetch-codex: ${error.message}`);
    process.exitCode = 1;
  }
}

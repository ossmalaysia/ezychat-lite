#!/usr/bin/env node
// Copies the root package.json "version" (the single source of truth) into every workspace
// package.json listed in the root "workspaces" field. Usage: npm run version:sync
// Pass --check to only report mismatches (exit 1 if any) without writing.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = rootPkg.version;
if (typeof version !== 'string' || !version) {
  console.error('root package.json has no "version"');
  process.exit(1);
}
const check = process.argv.includes('--check');

let mismatches = 0;
for (const ws of rootPkg.workspaces ?? []) {
  const file = join(root, ws, 'package.json');
  const raw = readFileSync(file, 'utf8');
  const pkg = JSON.parse(raw);
  const rel = relative(root, file).replaceAll('\\', '/');
  if (pkg.version === version) {
    console.log(`  ${rel}: ${version} (ok)`);
    continue;
  }
  mismatches++;
  if (check) {
    console.log(`  ${rel}: ${pkg.version} != ${version}`);
    continue;
  }
  // Replace only the top-level "version" value to keep the file's formatting intact.
  const next = raw.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1${JSON.stringify(version)}`);
  writeFileSync(file, next);
  console.log(`  ${rel}: ${pkg.version} -> ${version}`);
}

if (check && mismatches > 0) {
  console.error(`${mismatches} workspace(s) out of sync with root version ${version}; run npm run version:sync`);
  process.exit(1);
}
console.log(check ? `all workspaces at ${version}` : `synced workspaces to ${version}`);

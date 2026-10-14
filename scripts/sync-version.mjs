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
  // Published @ezychat/* packages depend on each other at exactly the release version.
  const internal = Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  })
    .filter(([name, range]) => name.startsWith('@ezychat/') && range !== version)
    .map(([name]) => name);
  if (pkg.version === version && internal.length === 0) {
    console.log(`  ${rel}: ${version} (ok)`);
    continue;
  }
  mismatches++;
  if (check) {
    console.log(
      `  ${rel}: ${pkg.version} != ${version}${internal.length ? ` (${internal.join(', ')})` : ''}`,
    );
    continue;
  }
  // Replace only the top-level "version" value and @ezychat/* ranges to keep the formatting intact.
  const next = raw
    .replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1${JSON.stringify(version)}`)
    .replace(/("@ezychat\/[a-z0-9-]+"\s*:\s*)"[^"]*"/g, `$1${JSON.stringify(version)}`);
  writeFileSync(file, next);
  console.log(
    `  ${rel}: ${pkg.version} -> ${version}${internal.length ? ` (${internal.join(', ')})` : ''}`,
  );
}

if (check && mismatches > 0) {
  console.error(
    `${mismatches} workspace(s) out of sync with root version ${version}; run npm run version:sync`,
  );
  process.exit(1);
}
console.log(check ? `all workspaces at ${version}` : `synced workspaces to ${version}`);

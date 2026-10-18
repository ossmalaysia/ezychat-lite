#!/usr/bin/env node
// Builds one publishable core package (packages/shared, packages/wa, packages/server) into dist/:
// tsc emits JS + .d.ts from src (tests excluded), then the files tsc does not emit are copied:
// hand-written .d.ts modules and the server's SQL migrations (db/migrate.ts finds dist/db/migrations).
// Run from the package directory (npm run build -w @ezychat/<name>), or pass the directory.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the three core packages of this repository can be built; anything else is refused.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['shared', 'wa', 'server'].map((name) => join(repoRoot, 'packages', name));
// Windows paths are case-insensitive (the drive letter's case differs between cwd and the script URL).
const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const pkgDir = PACKAGES.find((dir) => samePath(dir, resolve(process.argv[2] ?? process.cwd())));
if (!pkgDir) {
  console.error(
    `build-package: expected one of ${PACKAGES.map((d) => relative(repoRoot, d)).join(', ')}`,
  );
  process.exit(2);
}
const srcDir = join(pkgDir, 'src');
const distDir = join(pkgDir, 'dist');

rmSync(distDir, { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [tsc, '-p', join(pkgDir, 'tsconfig.build.json')], {
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

/** Files tsc never copies: ambient/hand-written declarations and SQL migrations. */
function shouldCopy(rel) {
  if (/\.test\./.test(rel)) return false;
  return rel.endsWith('.d.ts') || rel.endsWith('.sql');
}

let copied = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const rel = relative(srcDir, full);
      if (!shouldCopy(rel)) continue;
      const dest = join(distDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(full, dest);
      copied++;
    }
  }
}
walk(srcDir);
console.log(`built ${relative(process.cwd(), distDir) || 'dist'} (+${copied} copied file(s))`);

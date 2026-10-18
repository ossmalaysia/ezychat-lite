#!/usr/bin/env node
// Builds the desktop shell into dist/: tsc (main process JS + .d.ts, server host, preloads, locales), then
// copies the status window page (src/renderer) to dist/renderer, where the shell loads it from. The
// published @ezychat/desktop package ships dist/ only, never src/.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(pkgDir, 'dist');
// Start clean so files of removed modules never ship, but keep what scripts/bundle-server.mjs wrote
// (dist/server/ and dist/package.json): the shell build does not produce them.
const KEEP = new Set(['server', 'package.json']);
if (existsSync(distDir))
  for (const name of readdirSync(distDir))
    if (!KEEP.has(name)) rmSync(join(distDir, name), { recursive: true, force: true });

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [tsc, '-p', pkgDir], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

const renderer = join(distDir, 'renderer');
cpSync(join(pkgDir, 'src', 'renderer'), renderer, {
  recursive: true,
  filter: (src) => !/\.test\./.test(src),
});
console.log('built apps/desktop/dist (+ renderer)');

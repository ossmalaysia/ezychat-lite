#!/usr/bin/env node
// Builds the publishable core packages and writes their npm tarballs to ./.core-packs/
// (gitignored), for local Enterprise development:
//   npm run pack:core
//   (in the Enterprise repo) npm install ../whatsapp-manager/.core-packs/ezychat-server-<v>.tgz ...
// Never commit a file: dependency. --no-build packs the existing builds.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.core-packs');

/** Dependencies first (the publish workflow uses the same order). */
const CORE_PACKAGES = [
  '@ezychat/shared',
  '@ezychat/wa',
  '@ezychat/server',
  '@ezychat/web',
  '@ezychat/desktop',
];

function npm(args) {
  // npm is a .cmd shim on Windows, so run it through the shell (the arguments are fixed literals).
  const r = spawnSync(['npm', ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.argv.includes('--no-build')) npm(['run', 'build:core']);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
npm(['pack', ...CORE_PACKAGES.flatMap((p) => ['-w', p]), '--pack-destination', outDir]);
console.log(`core packages in ${outDir}:`);
for (const f of readdirSync(outDir)) console.log(`  ${f}`);

#!/usr/bin/env node
// Bundles packages/server/src/cli.ts (+ shared/wa/baileys) into a single CommonJS file for the
// desktop app: apps/desktop/dist/server/server.cjs, plus the SQL migrations next to it.
// Native modules (better-sqlite3, @node-rs/argon2) stay external and ship in node_modules
// (rebuilt for Electron by electron-builder). CommonJS is used so the entry can be loaded from
// inside app.asar by utilityProcess.fork and by ELECTRON_RUN_AS_NODE=1 (OS service).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps', 'desktop', 'dist', 'server');
const entry = join(root, 'packages', 'server', 'src', 'cli.ts');

const external = [
  // native addons — must be resolved from node_modules at runtime
  'better-sqlite3',
  '@node-rs/argon2',
  // optional peer deps of baileys / ws / others (loaded lazily inside try/catch)
  'sharp',
  'jimp',
  'link-preview-js',
  'audio-decode',
  'qrcode-terminal',
  'bufferutil',
  'utf-8-validate',
  'pino-pretty',
  'supports-color',
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile: join(outDir, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external,
  sourcemap: 'linked',
  legalComments: 'linked',
  logLevel: 'warning',
  metafile: true,
  mainFields: ['module', 'main'],
  conditions: ['node', 'import', 'require', 'default'],
  // ESM sources use import.meta.url (e.g. migrations lookup); map it to this file's URL.
  define: { 'import.meta.url': '__wati_import_meta_url' },
  banner: {
    js: "const __wati_import_meta_url = require('node:url').pathToFileURL(__filename).href;",
  },
});

// migrations: db/migrate.ts looks for ./migrations next to the running file
cpSync(join(root, 'packages', 'server', 'src', 'db', 'migrations'), join(outDir, 'migrations'), { recursive: true });

const version = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version;
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs', private: true, version }, null, 2) + '\n');

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(
  `bundled ${relative(root, entry)} -> ${relative(root, join(outDir, 'server.cjs'))} (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
);

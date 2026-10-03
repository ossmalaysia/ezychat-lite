#!/usr/bin/env node
// Bundles packages/server/src/cli.ts (+ shared/wa/baileys) into a single CommonJS file for the
// desktop app: apps/desktop/dist/server/server.cjs, plus the SQL migrations next to it.
// Native modules (better-sqlite3, @node-rs/argon2) stay external and ship in node_modules
// (rebuilt for Electron by electron-builder). CommonJS is used so the entry can be loaded from
// inside app.asar by utilityProcess.fork and by ELECTRON_RUN_AS_NODE=1 (OS service).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The 'import' condition below makes require('ws') resolve to ws/wrapper.mjs, whose namespace
// has no `Server` export, so engine.io's `require('ws').Server` (wsEngine) was undefined at
// runtime ("this.opts.wsEngine is not a constructor"). Resolve require() calls of ws the way
// Node does (CJS index.js), relative to the requiring package (engine.io has a nested ws).
const wsRequireAsCjs = {
  name: 'ws-require-cjs',
  setup(b) {
    b.onResolve({ filter: /^ws$/ }, (args) => {
      if (args.kind !== 'require-call') return undefined;
      return { path: createRequire(join(args.resolveDir, 'noop.js')).resolve('ws') };
    });
  },
};

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
  plugins: [wsRequireAsCjs],
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

// The root package.json version is the single source of truth (npm run version:sync copies it
// into apps/desktop, apps/web and packages/*), so /api/health reports the same version as the app.
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs', private: true, version }, null, 2) + '\n');
// The server's appVersion() reads <dir of running file>/../package.json, i.e. dist/package.json.
// Keep "type": "module" there so the tsc-compiled dist/main.js etc. stay ESM.
writeFileSync(
  join(outDir, '..', 'package.json'),
  JSON.stringify({ type: 'module', private: true, version }, null, 2) + '\n',
);

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(
  `bundled ${relative(root, entry)} -> ${relative(root, join(outDir, 'server.cjs'))} (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
);

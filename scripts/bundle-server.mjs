#!/usr/bin/env node
// Bundles packages/server/src/cli.ts (+ shared/wa/baileys) into a single CommonJS file for the
// desktop app: apps/desktop/dist/server/server.cjs, plus the SQL migrations next to it.
// Native modules (better-sqlite3, @node-rs/argon2, sherpa-onnx-node) stay external and ship in node_modules
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

// simple-yenc (used by ogg-opus-decoder's WASM loader) lists "require" first in its exports, and
// that file is CommonJS inside a "type": "module" package, so esbuild bundled it as ESM with no
// exports ("decode is not a function"). Always use its real ESM build.
const simpleYencEsm = {
  name: 'simple-yenc-esm',
  setup(b) {
    b.onResolve({ filter: /^simple-yenc$/ }, (args) => {
      const cjs = createRequire(join(args.resolveDir, 'noop.js')).resolve('simple-yenc');
      return { path: join(dirname(cjs), 'esm.js') };
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
  // Whisper (voice notes): Node-API addon + per-platform binaries (sherpa-onnx-<os>-<arch>),
  // loaded only by the voice-transcribe-worker.cjs thread
  'sherpa-onnx-node',
  // ogg-opus-decoder's optional ML speech enhancement (~4 MB of WASM), imported dynamically
  // only when enabled — never used here
  '@wasm-audio-decoders/opus-ml',
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
  '@napi-rs/canvas',
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
  plugins: [wsRequireAsCjs, simpleYencEsm],
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

// Upload parsing runs in a bounded worker rather than blocking the WhatsApp/auth server.
await build({
  entryPoints: [join(root, 'packages/server/src/ai/document-worker.ts')],
  outfile: join(outDir, 'ai-document-worker.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external,
  mainFields: ['module', 'main'],
  conditions: ['node', 'import', 'require', 'default'],
  logLevel: 'warning',
  legalComments: 'linked',
});

// Voice notes: the long-lived Whisper worker (voice/local-engine.ts looks for this file next to
// server.cjs). ogg-opus-decoder's WASM is inlined in its JS, so it survives bundling.
await build({
  entryPoints: [join(root, 'packages/server/src/voice/transcribe-worker.ts')],
  outfile: join(outDir, 'voice-transcribe-worker.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external,
  plugins: [simpleYencEsm],
  mainFields: ['module', 'main'],
  conditions: ['node', 'import', 'require', 'default'],
  logLevel: 'warning',
  legalComments: 'linked',
  define: { 'import.meta.url': '__wati_import_meta_url' },
  banner: {
    js: "const __wati_import_meta_url = require('node:url').pathToFileURL(__filename).href;",
  },
});

// migrations: db/migrate.ts looks for ./migrations next to the running file
cpSync(join(root, 'packages', 'server', 'src', 'db', 'migrations'), join(outDir, 'migrations'), {
  recursive: true,
});

// The root package.json version is the single source of truth (npm run version:sync copies it
// into apps/desktop, apps/web and packages/*), so /api/health reports the same version as the app.
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
writeFileSync(
  join(outDir, 'package.json'),
  JSON.stringify({ type: 'commonjs', private: true, version }, null, 2) + '\n',
);
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

#!/usr/bin/env node
/** Publish checked-in icon exports. Re-export the master with design/app-icon/export-assets.py. */
import { accessSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'design/app-icon');
const assets = [
  ['app-icon-512.png', 'apps/desktop/build/icon.png'],
  ['app-icon.ico', 'apps/desktop/build/icon.ico'],
  ['app-icon-16.png', 'apps/desktop/build/tray/tray.png'],
  ['app-icon-32.png', 'apps/desktop/build/tray/tray@2x.png'],
  ['app-icon-192.png', 'apps/web/public/icon-192.png'],
  ['app-icon-512.png', 'apps/web/public/icon-512.png'],
  ['app-icon-maskable-512.png', 'apps/web/public/icon-maskable-512.png'],
  ['apple-touch-icon.png', 'apps/web/public/apple-touch-icon.png'],
  ['app-icon.ico', 'apps/web/public/favicon.ico'],
];

// Check all inputs before replacing any output. Keep the monochrome macOS tray templates.
for (const [from] of assets) accessSync(join(source, from));
for (const [from, to] of assets) {
  const destination = join(root, to);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(source, from), destination);
  console.log('wrote', to);
}

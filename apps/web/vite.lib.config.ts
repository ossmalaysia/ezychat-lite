import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Library build of the published `@ezychat/web` package (npm run build:lib): the public entry
// src/index.ts as ESM in dist-lib/, with its CSS precompiled into one file (dist-lib/ezychat-web.css)
// so other product builds need no Tailwind scan of node_modules. Lite's own app build
// (vite.config.ts -> dist/) is separate and unchanged.
const PKG = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

// Every runtime dependency stays an import, so the consuming app shares one React, router,
// query client and i18next instance with its own extensions. `virtual:pwa-register` comes from the
// consumer's vite-plugin-pwa (the service worker source ships as dist-lib/sw.ts).
const externalPackages = Object.keys({ ...PKG.dependencies, ...PKG.peerDependencies });
function isExternal(id: string): boolean {
  if (id.startsWith('virtual:')) return true;
  return externalPackages.some((name) => id === name || id.startsWith(`${name}/`));
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    conditions: ['ezychat-source', ...defaultClientConditions],
  },
  plugins: [react(), tailwindcss()],
  publicDir: false,
  build: {
    outDir: 'dist-lib',
    emptyOutDir: false, // build-lib.mjs cleans it and adds the type declarations
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'ezychat-web',
    },
    rolldownOptions: {
      external: isExternal,
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});

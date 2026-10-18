import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';

// `npm test -w @ezychat/<pkg>` runs Vitest inside the package folder, where it only looks for a
// config in that folder (never in parent folders). Each core package therefore needs its own
// config that keeps the "ezychat-source" condition, or @ezychat/* resolve to (stale or missing) dist/.
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.js',
  'vitest.config.mjs',
];

describe.each(['shared', 'wa', 'server'])('packages/%s run on its own', (name) => {
  const root = join(repo, 'packages', name);

  it('resolves @ezychat/shared to its TypeScript source', async () => {
    const configFile = CONFIG_NAMES.map((file) => join(root, file)).find((file) =>
      existsSync(file),
    );
    expect(configFile, `packages/${name} has no vitest.config`).toBeDefined();

    const server = await createServer({
      root,
      configFile,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const importer = join(root, 'src', 'index.ts');
      for (const ssr of [true, false]) {
        const resolved = await server.pluginContainer.resolveId('@ezychat/shared', importer, {
          ssr,
        });
        expect(resolved?.id.replaceAll('\\', '/')).toMatch(/\/packages\/shared\/src\/index\.ts$/);
      }
    } finally {
      await server.close();
    }
  }, 30_000);
});

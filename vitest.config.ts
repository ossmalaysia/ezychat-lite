import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Inside this monorepo @ezychat/* packages resolve to their TypeScript source through the
// "ezychat-source" export condition (published builds resolve to dist/).
export const sourceResolve = {
  resolve: { conditions: ['ezychat-source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['ezychat-source', ...defaultServerConditions] } },
};

// Root config: every workspace is a Vitest project. A workspace may add its own
// vitest.config.ts (e.g. apps/web uses jsdom); the core packages inherit this file.
export default defineConfig({
  ...sourceResolve,
  test: {
    projects: [
      ...['shared', 'wa', 'server'].map((name) => ({
        extends: true,
        root: `packages/${name}`,
        test: { name: `@ezychat/${name}` },
      })),
      'apps/*',
      { extends: true, test: { name: 'scripts', include: ['scripts/**/*.test.{mjs,ts}'] } },
    ],
    passWithNoTests: true,
    // Transforms dominated test time (~86%); persist them across runs.
    fsModuleCache: true,
  },
});

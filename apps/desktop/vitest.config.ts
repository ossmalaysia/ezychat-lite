import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Desktop tests run under Node. `.cts` sources (CommonJS entry points such as server-host.cts)
// must be transformed as TypeScript too.
export default defineConfig({
  // @ezychat/* resolve to their TypeScript source inside the monorepo (see the root vitest.config.ts).
  resolve: { conditions: ['ezychat-source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['ezychat-source', ...defaultServerConditions] } },
  oxc: { include: /\.(m?ts|cts|[jt]sx)$/ },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
});

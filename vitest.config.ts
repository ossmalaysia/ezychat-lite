import { defineConfig } from 'vitest/config';

// Root config: every workspace is a Vitest project. A workspace may add its own
// vitest.config.ts (e.g. apps/web uses jsdom); otherwise defaults apply.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    passWithNoTests: true,
  },
});

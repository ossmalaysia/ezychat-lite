import { defineConfig } from 'vitest/config';

// Desktop tests run under Node. `.cts` sources (CommonJS entry points such as server-host.cts)
// must be transformed as TypeScript too.
export default defineConfig({
  oxc: { include: /\.(m?ts|cts|[jt]sx)$/ },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
});

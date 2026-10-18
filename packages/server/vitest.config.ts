import { defineConfig } from 'vitest/config';
import { sourceResolve } from '../../vitest.config';

// Used by `npm test -w @ezychat/server` (Vitest never reads the root config from here): keep the
// "ezychat-source" condition so @ezychat/* resolve to their TypeScript source, not dist/.
export default defineConfig({
  ...sourceResolve,
  test: { passWithNoTests: true },
});

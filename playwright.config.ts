import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

/**
 * E2E: builds the web app, starts the real server with the fake WhatsApp adapter on a fresh
 * data dir (.e2e-data) and drives it with three projects: desktop Chromium, Pixel 7 and
 * iPhone 14 (iPhone runs on the Chromium engine so WebKit does not have to be installed).
 *
 * A `setup` project runs first (first-run wizard → admin storage state + shared quick reply);
 * every other project depends on it.
 */
const PORT = 7499;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Prefer Playwright's bundled Chromium; fall back to an installed Google Chrome when the
// bundled browser could not be downloaded (e.g. offline / blocked CDN).
function hasBundledChromium(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const chromiumEngine = hasBundledChromium()
  ? { browserName: 'chromium' as const }
  : { browserName: 'chromium' as const, channel: 'chrome' };

const ADMIN_STATE = 'e2e/.auth/admin.json';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    // Specs match English text; the app otherwise follows the browser language.
    locale: 'en-US',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], ...chromiumEngine },
    },
    {
      name: 'desktop-chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], ...chromiumEngine, storageState: ADMIN_STATE },
    },
    {
      name: 'mobile',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], ...chromiumEngine, storageState: ADMIN_STATE },
    },
    {
      name: 'iphone',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['iPhone 14'], ...chromiumEngine, storageState: ADMIN_STATE },
    },
  ],
  webServer: {
    // The data dir is wiped here (not in globalSetup): Playwright starts the webServer
    // before globalSetup runs, so deleting it there would pull the DB out from under the server.
    command:
      'node e2e/clean-data.mjs && npm run build -w @wa-team-inbox/web && npx tsx packages/server/src/cli.ts --data .e2e-data --port 7499 --fake-wa --mode dev --web-dist apps/web/dist',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

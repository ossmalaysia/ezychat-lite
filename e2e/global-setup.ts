import { rmSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';

/**
 * Runs after the webServer is up (Playwright starts webServer first). The server data dir
 * (.e2e-data) is wiped by `e2e/clean-data.mjs` in the webServer command; here we only drop stale
 * auth state and verify we really got a fresh server (setup still needed) so a leftover server
 * or data dir cannot silently make the run order-dependent.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  rmSync('e2e/.auth', { recursive: true, force: true });
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://127.0.0.1:7499';
  const res = await fetch(`${baseURL}/api/setup/status`);
  if (!res.ok) throw new Error(`setup status failed: HTTP ${res.status}`);
  const body = (await res.json()) as { needsSetup?: boolean };
  if (body.needsSetup !== true) {
    throw new Error('E2E server is not fresh (setup already done). Delete .e2e-data and retry.');
  }
}

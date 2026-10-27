// Third e2e server for e2e/partner-connectors.spec.ts: the same built web app, fake WhatsApp, a fresh
// data dir, and the local partner MCP test server (e2e/partner-mcp) with its signed TEST connector
// list. The app downloads that list (dev-only switches EZYCHAT_CONNECTOR_LIST_URL/_TEST_KEY) and may
// reach partner servers on this computer (CONNECTORS_TEST_ALLOW_LOCAL, dev mode with fake WhatsApp
// only). It waits for the main e2e server first: that one builds apps/web/dist.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadOrCreateCert } from './partner-mcp/cert.mjs';
import { createListKeys } from './partner-mcp/list.mjs';
import { startPartnerMcp } from './partner-mcp/server.mjs';

const MAIN_HEALTH = 'http://127.0.0.1:7499/api/health';
const PARTNER_PORT = 7611;
const dataDir = resolve(process.cwd(), '.e2e-data-partners');

async function waitForMain() {
  for (let i = 0; i < 480; i++) {
    try {
      const res = await fetch(MAIN_HEALTH);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the main e2e server did not start');
}

rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
const cert = loadOrCreateCert(join(dataDir, 'partner-kit'));
// Access tokens live 60 s so the spec's OAuth connection also exercises refresh.
const kit = await startPartnerMcp({
  port: PARTNER_PORT,
  tls: cert,
  accessTokenTtlSeconds: 60,
  controlToken: 'e2e-partner-control',
  list: createListKeys(),
});
await waitForMain();

// Node runs tsx's CLI directly: no npx and no shell, so nothing is looked up on PATH.
const tsxCli = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
const child = spawn(
  process.execPath,
  [
    '--conditions=ezychat-source',
    tsxCli,
    'packages/server/src/cli.ts',
    '--data',
    join(dataDir, 'app'),
    '--port',
    '7497',
    '--fake-wa',
    '--mode',
    'dev',
    '--web-dist',
    'apps/web/dist',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CONNECTORS_TEST_ALLOW_LOCAL: '1',
      NODE_EXTRA_CA_CERTS: cert.certPath,
      EZYCHAT_CONNECTOR_LIST_URL: kit.listBaseUrl,
      EZYCHAT_CONNECTOR_LIST_TEST_KEY: kit.listPublicKey,
    },
  },
);
const stop = () => {
  child.kill();
  void kit.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  void kit.close().finally(() => process.exit(code ?? 0));
});

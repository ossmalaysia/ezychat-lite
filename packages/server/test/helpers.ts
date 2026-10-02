import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWaAdapter } from '@wa-team-inbox/wa';
import { buildApp } from '../src/app.js';
import type { ServerConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { silentLogger } from '../src/logger.js';
import { createContext, runInitializers, shutdownServices } from '../src/main.js';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  wa: FakeWaAdapter;
  close(): Promise<void>;
}

/**
 * Builds a full app on a temp data dir (mode 'dev', fake WA, no listen — use app.inject).
 * Runs all registered service initializers. `config` overrides individual ServerConfig fields.
 */
export async function makeTestApp(opts?: { wa?: FakeWaAdapter; config?: Partial<ServerConfig> }): Promise<TestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'wati-test-'));
  const config: ServerConfig = {
    dataDir,
    port: 0,
    host: '127.0.0.1',
    mode: 'dev',
    fakeWa: true,
    webDistDir: null,
    version: '0.0.0-test',
    ...opts?.config,
  };
  const wa = opts?.wa ?? new FakeWaAdapter();
  const ctx = await createContext(config, { wa, log: silentLogger() });
  await runInitializers(ctx);
  const app = await buildApp(ctx);
  await app.ready();
  await wa.connect();

  let closed = false;
  return {
    app,
    ctx,
    wa,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await shutdownServices(ctx);
      await wa.disconnect().catch(() => undefined);
      ctx.bus.removeAllListeners();
      ctx.db.close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

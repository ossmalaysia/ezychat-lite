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
import { attachRealtime, type RealtimeService } from '../src/realtime/index.js';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  wa: FakeWaAdapter;
  /** base URL (http://127.0.0.1:<port>) when created with `listen: true`, else undefined */
  url?: string;
  close(): Promise<void>;
}

/**
 * Builds a full app on a temp data dir (mode 'dev', fake WA, no listen — use app.inject).
 * Runs all registered service initializers. `config` overrides individual ServerConfig fields.
 * `listen: true` listens on an ephemeral 127.0.0.1 port, attaches Socket.IO realtime and returns `url`.
 */
export async function makeTestApp(opts?: {
  wa?: FakeWaAdapter;
  config?: Partial<ServerConfig>;
  listen?: boolean;
  /** Runs after service initializers and before routes are built (routes capture services). */
  beforeBuild?: (ctx: AppContext) => void | Promise<void>;
}): Promise<TestApp> {
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
  await opts?.beforeBuild?.(ctx);
  const app = await buildApp(ctx);
  await app.ready();
  let url: string | undefined;
  let realtime: RealtimeService | null = null;
  if (opts?.listen) {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected server address');
    url = `http://127.0.0.1:${addr.port}`;
    realtime = attachRealtime(app.server, ctx);
  }
  await wa.connect();

  let closed = false;
  return {
    app,
    ctx,
    wa,
    url,
    async close() {
      if (closed) return;
      closed = true;
      realtime?.close();
      await app.close();
      await shutdownServices(ctx);
      await wa.disconnect().catch(() => undefined);
      ctx.bus.removeAllListeners();
      ctx.db.close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

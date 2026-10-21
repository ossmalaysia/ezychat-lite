import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWaAdapter } from '@ezychat/wa';
import { buildApp } from '../src/app.js';
import type { ServerConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDb } from '../src/db/index.js';
import type { ServerExtension } from '../src/extensions.js';
import { InboxRepo } from '../src/inboxes/repo.js';
import { silentLogger } from '../src/logger.js';
import { createContext, runInitializers, shutdownServices } from '../src/main.js';
import { attachRealtime, type RealtimeService } from '../src/realtime/index.js';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  /** The fake WhatsApp adapter of inbox 1. */
  wa: FakeWaAdapter;
  /** The fake WhatsApp adapter of an inbox (throws for an unknown or removed inbox). */
  inboxWa(id: number): FakeWaAdapter;
  /**
   * Adds an inbox as an admin would (row, members, connected fake phone); returns its id.
   * Throws `inbox_limit` above `maxInboxes`.
   */
  addInbox(name: string, memberIds?: number[]): Promise<number>;
  /** base URL (http://127.0.0.1:<port>) when created with `listen: true`, else undefined */
  url?: string;
  close(): Promise<void>;
}

/**
 * Builds a full app on a temp data dir (mode 'dev', fake WA, no listen — use app.inject).
 * Runs all registered service initializers. `config` overrides individual ServerConfig fields.
 * `listen: true` listens on an ephemeral 127.0.0.1 port, attaches Socket.IO realtime and returns `url`.
 * `maxInboxes` is the build's inbox limit (default 1, as Lite); `inboxes` creates that many inboxes
 * (inbox 1 included) before the services start, each with its own fake phone.
 */
export async function makeTestApp(opts?: {
  wa?: FakeWaAdapter;
  config?: Partial<ServerConfig>;
  listen?: boolean;
  /** Runs after service initializers and before routes are built (routes capture services). */
  beforeBuild?: (ctx: AppContext) => void | Promise<void>;
  /** Extensions as another product build would pass them (Lite: none). */
  extensions?: readonly ServerExtension[];
  /** Edition reported by /api/health (default 'lite'). */
  edition?: string;
  /** Most inboxes (default 1, as Lite). */
  maxInboxes?: number;
  /** Inboxes that exist at start, inbox 1 included (default 1). */
  inboxes?: number;
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
  const maxInboxes = opts?.maxInboxes ?? 1;
  const startInboxes = opts?.inboxes ?? 1;
  if (startInboxes > maxInboxes) throw new Error('inboxes > maxInboxes');
  let ctx: AppContext;
  try {
    if (startInboxes > 1) {
      // inboxes that exist before the server starts, as a restarted Enterprise install has them
      const db = openDb(join(dataDir, 'app.db'));
      const repo = new InboxRepo(db);
      for (let i = 2; i <= startInboxes; i++)
        repo.insert(`Inbox ${i}`, repo.nextTone(), Date.now());
      db.close();
    }
    ctx = await createContext(config, {
      wa,
      log: silentLogger(),
      extensions: opts?.extensions,
      edition: opts?.edition,
      maxInboxes,
      connectStaggerMs: 0,
    });
  } catch (err) {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    throw err;
  }
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
  await ctx.inboxes.connections.connectAll();

  const inboxWa = (id: number) => ctx.inboxes.connections.adapter(id) as FakeWaAdapter;
  let closed = false;
  return {
    app,
    ctx,
    wa,
    inboxWa,
    async addInbox(name, memberIds = []) {
      const { repo, connections } = ctx.inboxes;
      if (repo.active().length >= connections.maxInboxes()) throw new Error('inbox_limit');
      const row = repo.insert(name, repo.nextTone(), Date.now());
      repo.setMembers(row.id, memberIds);
      await connections.add(row);
      return row.id;
    },
    url,
    async close() {
      if (closed) return;
      closed = true;
      realtime?.close();
      await app.close();
      await shutdownServices(ctx);
      await ctx.inboxes.connections.disconnectAll();
      ctx.bus.removeAllListeners();
      ctx.db.close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

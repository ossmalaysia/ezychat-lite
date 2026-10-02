import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { FakeWaAdapter, type WaAdapter, type WaAdapterOptions } from '@wa-team-inbox/wa';
import type { Logger } from 'pino';
import { buildApp } from './app.js';
import { Bus } from './bus.js';
import type { ServerConfig } from './config.js';
import type { AppContext } from './context.js';
import { SecretBox } from './crypto/secret.js';
import { openDb } from './db/index.js';
import { SettingsStore } from './db/settings.js';
import { acquireLock } from './lock.js';
import { createLogger } from './logger.js';
import { initializers } from './services.js';
import { attachRealtime } from './realtime/index.js';

/** Loads the Baileys adapter lazily (keeps baileys out of tests / --fake-wa runs). */
async function createRealWaAdapter(opts: WaAdapterOptions): Promise<WaAdapter> {
  const mod = (await import('@wa-team-inbox/wa')) as Record<string, unknown>;
  const create = mod.createBaileysAdapter as ((o: WaAdapterOptions) => WaAdapter) | undefined;
  if (typeof create !== 'function') throw new Error('createBaileysAdapter is not available in @wa-team-inbox/wa');
  return create(opts);
}

/** Builds the AppContext (db, secrets, settings, bus, wa) without listening. Shared by startServer and tests. */
export async function createContext(
  cfg: ServerConfig,
  deps: { wa?: WaAdapter; log: Logger },
): Promise<AppContext> {
  const { log } = deps;
  const db = openDb(join(cfg.dataDir, 'app.db'));
  const secret = SecretBox.loadOrCreate(join(cfg.dataDir, 'secret.key'));
  const settings = new SettingsStore(db, secret);
  const bus = new Bus((err, ev) => log.error({ err, event: ev }, 'bus listener failed'));
  const historyDays = settings.get<number>('history_days', 30);
  const wa =
    deps.wa ??
    (cfg.fakeWa
      ? new FakeWaAdapter()
      : await createRealWaAdapter({ authDir: join(cfg.dataDir, 'wa-auth'), historyDays, logger: log.child({ mod: 'wa' }) }));
  return { config: cfg, db, bus, log, secret, settings, wa, services: {} };
}

/** Runs the initializers registered in services.ts, in order. */
export async function runInitializers(ctx: AppContext): Promise<void> {
  for (const init of initializers) await init(ctx);
}

/** Calls shutdown()/close() on every registered service that has one (best effort). */
export async function shutdownServices(ctx: AppContext): Promise<void> {
  for (const [name, svc] of Object.entries(ctx.services).reverse()) {
    const s = svc as { shutdown?: () => unknown; close?: () => unknown } | null;
    try {
      if (s && typeof s.shutdown === 'function') await s.shutdown();
      else if (s && typeof s.close === 'function') await s.close();
    } catch (err) {
      ctx.log.warn({ err, service: name }, 'service shutdown failed');
    }
  }
}

export async function startServer(
  cfg: ServerConfig,
  deps?: { wa?: WaAdapter },
): Promise<{ app: FastifyInstance; ctx: AppContext; close(): Promise<void> }> {
  const lock = acquireLock(cfg.dataDir);
  const logger = await createLogger({ dataDir: cfg.dataDir });
  const log = logger.log;

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    logger.close();
    lock.release();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'unhandled rejection');
  });

  let ctx: AppContext;
  try {
    ctx = await createContext(cfg, { wa: deps?.wa, log });
  } catch (err) {
    lock.release();
    logger.close();
    throw err;
  }

  // Port / bind host fall back to persisted settings unless given explicitly.
  if (cfg.portExplicit === false) cfg.port = ctx.settings.get<number>('port', cfg.port);
  if (cfg.hostExplicit === false) cfg.host = ctx.settings.get<boolean>('lan_enabled', false) ? '0.0.0.0' : '127.0.0.1';

  await runInitializers(ctx);
  const app = await buildApp(ctx);
  await app.listen({ port: cfg.port, host: cfg.host });
  log.info({ port: cfg.port, host: cfg.host, mode: cfg.mode, version: cfg.version, fakeWa: cfg.fakeWa }, 'server listening');
  const realtime = attachRealtime(app.server, ctx);

  ctx.wa.connect().catch((err: unknown) => log.error({ err }, 'wa connect failed'));

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      log.info('shutting down');
      realtime.close(); // drop websocket clients first so the HTTP server can close
      try {
        await app.close();
      } catch (err) {
        log.warn({ err }, 'http close failed');
      }
      await shutdownServices(ctx);
      try {
        await ctx.wa.disconnect();
      } catch (err) {
        log.warn({ err }, 'wa disconnect failed');
      }
      ctx.bus.removeAllListeners();
      try {
        ctx.db.close();
      } catch {
        // ignore
      }
      lock.release();
      logger.close();
    })();
    return closing;
  };

  const onSignal = (sig: string) => {
    log.info({ sig }, 'signal received');
    void close().finally(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return { app, ctx, close };
}

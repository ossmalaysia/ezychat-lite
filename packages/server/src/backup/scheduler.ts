import type { AppContext } from '../context.js';
import { hasBackupFor, runBackup } from './backup.js';

export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Delay before the startup check so backups never slow down boot. */
export const BACKUP_STARTUP_DELAY_MS = 10_000;

export interface BackupScheduler {
  /** Runs a backup now (logs failures, never throws). */
  runNow(): Promise<string | null>;
  shutdown(): void;
}

/**
 * Runs a backup shortly after startup if today's is missing, then every 24h.
 * Timers are unref'd so they never keep the process alive.
 */
export function startBackupScheduler(
  ctx: AppContext,
  opts: { startupDelayMs?: number; intervalMs?: number } = {},
): BackupScheduler {
  const log = ctx.log.child({ mod: 'backup' });
  let stopped = false;
  let running: Promise<string | null> | null = null;

  const runNow = (): Promise<string | null> => {
    if (stopped) return Promise.resolve(null);
    running ??= runBackup(ctx.config.dataDir, ctx.db)
      .then((file) => {
        log.info({ file }, 'backup written');
        return file;
      })
      .catch((err: unknown) => {
        log.error({ err }, 'backup failed');
        return null;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const startup = setTimeout(() => {
    if (!stopped && !hasBackupFor(ctx.config.dataDir)) void runNow();
  }, opts.startupDelayMs ?? BACKUP_STARTUP_DELAY_MS);
  startup.unref?.();

  const interval = setInterval(() => void runNow(), opts.intervalMs ?? BACKUP_INTERVAL_MS);
  interval.unref?.();

  return {
    runNow,
    shutdown() {
      stopped = true;
      clearTimeout(startup);
      clearInterval(interval);
    },
  };
}

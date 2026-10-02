import { pino, multistream, type Level, type Logger, type StreamEntry } from 'pino';
import pinoRoll from 'pino-roll';
import { join } from 'node:path';

export type { Logger };

export interface LoggerHandle {
  log: Logger;
  /** flushes and closes file streams */
  close(): void;
}

/**
 * Creates the server logger. With a dataDir, writes JSON lines to `<data>/logs/server.log`
 * rotated daily (keeps 14 files) via pino-roll, plus stdout. Runs in-process (no worker
 * transport) so it works inside Electron utilityProcess / OS services.
 */
export async function createLogger(opts: {
  dataDir?: string | null;
  level?: string;
  stdout?: boolean;
}): Promise<LoggerHandle> {
  const level = opts.level ?? process.env.WATI_LOG_LEVEL ?? 'info';
  const streams: StreamEntry[] = [];
  let fileStream: { end(): void } | null = null;
  if (opts.dataDir) {
    const s = await pinoRoll({
      file: join(opts.dataDir, 'logs', 'server.log'),
      frequency: 'daily',
      mkdir: true,
      limit: { count: 14 },
    });
    fileStream = s;
    streams.push({ level: level as Level, stream: s });
  }
  if (opts.stdout !== false) streams.push({ level: level as Level, stream: process.stdout });
  const log =
    streams.length === 0
      ? pino({ level: 'silent' })
      : pino({ level, base: { app: 'wa-team-inbox' } }, multistream(streams));
  return {
    log,
    close() {
      try {
        log.flush();
      } catch {
        // ignore
      }
      fileStream?.end();
    },
  };
}

/** Logger that discards everything (tests). */
export function silentLogger(): Logger {
  return pino({ level: 'silent' });
}

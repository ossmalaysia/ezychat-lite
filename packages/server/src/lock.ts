import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class LockedError extends Error {
  readonly code = 'locked' as const;
  constructor(
    public readonly pid: number,
    lockFile: string,
  ) {
    super(`data dir is in use by another server (pid ${pid}, lock ${lockFile})`);
    this.name = 'LockedError';
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: process exists but we can't signal it (e.g. owned by a service account)
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * One server per data dir. Writes `server.lock` containing our pid.
 * Throws LockedError when a live process holds it; a stale lock (dead/invalid pid) is taken over.
 */
export function acquireLock(dataDir: string): { release(): void } {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'server.lock');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          try {
            if (readFileSync(file, 'utf8').trim() === String(process.pid)) rmSync(file, { force: true });
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let pid = NaN;
      try {
        pid = parseInt(readFileSync(file, 'utf8').trim(), 10);
      } catch {
        // vanished between open and read: retry
      }
      // Note: a lock holding our own pid is held by this process (e.g. second acquire in-process).
      if (pidAlive(pid)) throw new LockedError(pid, file);
      rmSync(file, { force: true });
    }
  }
  throw new Error(`could not acquire lock ${file}`);
}

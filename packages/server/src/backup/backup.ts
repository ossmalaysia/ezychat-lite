import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db/index.js';

/** Number of backups of each kind (db file, wa-auth dir) that are kept. */
export const BACKUP_KEEP = 7;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-date stamp `YYYYMMDD`. */
export function backupStamp(now: Date): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export function backupsDir(dataDir: string): string {
  return join(dataDir, 'backups');
}

/** True when the database backup for `now`'s local date already exists. */
export function hasBackupFor(dataDir: string, now: Date = new Date()): boolean {
  return existsSync(join(backupsDir(dataDir), `app-${backupStamp(now)}.db`));
}

function prune(dir: string, re: RegExp, keep: number): void {
  const names = readdirSync(dir)
    .filter((n) => re.test(n))
    .sort(); // YYYYMMDD sorts chronologically
  for (const n of names.slice(0, Math.max(0, names.length - keep))) {
    rmSync(join(dir, n), { recursive: true, force: true });
  }
}

/**
 * Nightly backup: `VACUUM INTO backups/app-YYYYMMDD.db` (same-day backup overwritten) and a copy of
 * `wa-auth` → `backups/wa-auth-YYYYMMDD/`. Keeps the newest 7 of each. Returns the db backup path.
 */
export async function runBackup(dataDir: string, db: DB, now: Date = new Date()): Promise<string> {
  const dir = backupsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const stamp = backupStamp(now);

  const dbFile = join(dir, `app-${stamp}.db`);
  rmSync(dbFile, { force: true });
  db.prepare('VACUUM INTO ?').run(dbFile);

  const authSrc = join(dataDir, 'wa-auth');
  if (existsSync(authSrc)) {
    const authDst = join(dir, `wa-auth-${stamp}`);
    rmSync(authDst, { recursive: true, force: true });
    cpSync(authSrc, authDst, { recursive: true });
  }

  prune(dir, /^app-\d{8}\.db$/, BACKUP_KEEP);
  prune(dir, /^wa-auth-\d{8}$/, BACKUP_KEEP);
  return dbFile;
}

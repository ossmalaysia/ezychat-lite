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

/** Days a pre-merge backup (`app-premerge-YYYYMMDD.db`) is kept; the daily rotation ignores it. */
export const PREMERGE_KEEP_DAYS = 30;

function prunePremerge(dir: string, now: Date): void {
  // Calendar days (not 30 * 24h) so a DST change cannot shift the cutoff by a day.
  const cutoff = backupStamp(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - PREMERGE_KEEP_DAYS),
  );
  for (const n of readdirSync(dir)) {
    const m = /^(?:app|wa-auth)-premerge-(\d{8})(?:\.db)?$/.exec(n);
    if (m && m[1]! < cutoff) rmSync(join(dir, n), { recursive: true, force: true });
  }
}

/**
 * Synchronous backup: `VACUUM INTO backups/app-[label-]YYYYMMDD.db` plus a copy of `wa-auth`.
 * Must not run inside a SQLite transaction (VACUUM INTO fails there). Daily backups keep the newest
 * 7; labelled pre-merge backups are kept PREMERGE_KEEP_DAYS days. Returns the db backup path.
 */
export function runBackupSync(
  dataDir: string,
  db: DB,
  now: Date = new Date(),
  opts: { label?: string } = {},
): string {
  if (db.inTransaction) throw new Error('runBackupSync cannot run inside a SQLite transaction');
  const dir = backupsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const stamp = opts.label ? `${opts.label}-${backupStamp(now)}` : backupStamp(now);

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
  prunePremerge(dir, now);
  return dbFile;
}

/** Nightly backup (see runBackupSync). */
export async function runBackup(dataDir: string, db: DB, now: Date = new Date()): Promise<string> {
  return runBackupSync(dataDir, db, now);
}

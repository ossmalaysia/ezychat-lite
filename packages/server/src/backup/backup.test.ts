import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupStamp, hasBackupFor, runBackup, runBackupSync } from './backup.js';

describe('runBackup', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wati-backup-'));
    db = new Database(join(dir, 'app.db'));
    db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (42);');
    mkdirSync(join(dir, 'wa-auth'));
    writeFileSync(join(dir, 'wa-auth', 'creds.json'), '{"a":1}');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('formats the stamp as local YYYYMMDD', () => {
    expect(backupStamp(new Date(2026, 0, 5, 23, 59))).toBe('20260105');
  });

  it('writes a VACUUM INTO copy and the wa-auth dir', async () => {
    const now = new Date(2026, 9, 2, 3, 0);
    const file = await runBackup(dir, db, now);
    expect(file).toBe(join(dir, 'backups', 'app-20261002.db'));
    expect(existsSync(file)).toBe(true);
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
    copy.close();
    expect(readFileSync(join(dir, 'backups', 'wa-auth-20261002', 'creds.json'), 'utf8')).toBe(
      '{"a":1}',
    );
    expect(hasBackupFor(dir, now)).toBe(true);
    expect(hasBackupFor(dir, new Date(2026, 9, 3))).toBe(false);
  });

  it('overwrites a same-day backup', async () => {
    const now = new Date(2026, 9, 2, 3, 0);
    await runBackup(dir, db, now);
    db.exec('INSERT INTO t VALUES (43)');
    const file = await runBackup(dir, db, now);
    const copy = new Database(file, { readonly: true });
    expect((copy.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(2);
    copy.close();
  });

  it('works without a wa-auth dir', async () => {
    rmSync(join(dir, 'wa-auth'), { recursive: true });
    const file = await runBackup(dir, db, new Date(2026, 9, 2));
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(dir, 'backups', 'wa-auth-20261002'))).toBe(false);
  });

  it('prunes to the newest 7 of each kind', async () => {
    for (let d = 1; d <= 10; d++) await runBackup(dir, db, new Date(2026, 9, d, 3, 0));
    const entries = readdirSync(join(dir, 'backups')).sort();
    const dbs = entries.filter((e) => e.startsWith('app-'));
    const auths = entries.filter((e) => e.startsWith('wa-auth-'));
    expect(dbs).toHaveLength(7);
    expect(auths).toHaveLength(7);
    expect(dbs[0]).toBe('app-20261004.db');
    expect(dbs[6]).toBe('app-20261010.db');
    expect(auths[0]).toBe('wa-auth-20261004');
  });
  it('writes a labelled pre-merge backup that the daily rotation never deletes', () => {
    const now = new Date(2026, 9, 5, 9, 0);
    const file = runBackupSync(dir, db, now, { label: 'premerge' });
    expect(file).toBe(join(dir, 'backups', 'app-premerge-20261005-090000.db'));
    expect(
      readFileSync(join(dir, 'backups', 'wa-auth-premerge-20261005-090000', 'creds.json'), 'utf8'),
    ).toBe('{"a":1}');
    for (let d = 6; d <= 14; d++) runBackupSync(dir, db, new Date(2026, 9, d, 3, 0));
    const names = readdirSync(join(dir, 'backups'));
    expect(names).toContain('app-premerge-20261005-090000.db');
    expect(names.filter((n) => /^app-\d{8}\.db$/.test(n))).toHaveLength(7);
    expect(hasBackupFor(dir, now)).toBe(false);
  });

  it('removes pre-merge backups after 30 days', () => {
    runBackupSync(dir, db, new Date(2026, 9, 5), { label: 'premerge' });
    // a pre-merge backup in the older date-only format is pruned too
    mkdirSync(join(dir, 'backups', 'wa-auth-premerge-20261004'));
    writeFileSync(join(dir, 'backups', 'app-premerge-20261004.db'), '');
    runBackupSync(dir, db, new Date(2026, 10, 3));
    expect(existsSync(join(dir, 'backups', 'app-premerge-20261005-000000.db'))).toBe(true);
    expect(existsSync(join(dir, 'backups', 'app-premerge-20261004.db'))).toBe(true);
    runBackupSync(dir, db, new Date(2026, 10, 4));
    expect(existsSync(join(dir, 'backups', 'app-premerge-20261004.db'))).toBe(false);
    expect(existsSync(join(dir, 'backups', 'wa-auth-premerge-20261004'))).toBe(false);
    expect(existsSync(join(dir, 'backups', 'app-premerge-20261005-000000.db'))).toBe(true);
    runBackupSync(dir, db, new Date(2026, 10, 5));
    expect(existsSync(join(dir, 'backups', 'app-premerge-20261005-000000.db'))).toBe(false);
    expect(existsSync(join(dir, 'backups', 'wa-auth-premerge-20261005-000000'))).toBe(false);
  });

  it('never overwrites a labelled backup: two on the same day (even the same second) both remain', () => {
    const first = runBackupSync(dir, db, new Date(2026, 9, 5, 9, 0), { label: 'premerge' });
    db.exec('INSERT INTO t VALUES (43)');
    const second = runBackupSync(dir, db, new Date(2026, 9, 5, 9, 0), { label: 'premerge' });
    const third = runBackupSync(dir, db, new Date(2026, 9, 5, 14, 30, 5), { label: 'premerge' });
    expect([first, second, third]).toEqual([
      join(dir, 'backups', 'app-premerge-20261005-090000.db'),
      join(dir, 'backups', 'app-premerge-20261005-090000-2.db'),
      join(dir, 'backups', 'app-premerge-20261005-143005.db'),
    ]);
    const rows = (f: string) => {
      const copy = new Database(f, { readonly: true });
      const n = (copy.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n;
      copy.close();
      return n;
    };
    expect([rows(first), rows(second)]).toEqual([1, 2]);
    expect(existsSync(join(dir, 'backups', 'wa-auth-premerge-20261005-090000-2'))).toBe(true);
  });

  it.each(['', 'Pre-merge', '../x', 'pre merge'])('rejects the backup label %j', (label) => {
    expect(() => runBackupSync(dir, db, new Date(2026, 9, 5), { label })).toThrow(/label/);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('keeps every inbox’s WhatsApp folder and never moves wa-auth (RF-5)', () => {
    mkdirSync(join(dir, 'wa-auth-inboxes', '2'), { recursive: true });
    writeFileSync(join(dir, 'wa-auth-inboxes', '2', 'creds.json'), '{"two":1}');
    const before = readFileSync(join(dir, 'wa-auth', 'creds.json'));
    for (let d = 1; d <= 9; d++) runBackupSync(dir, db, new Date(2026, 9, d, 3, 0));
    const b = join(dir, 'backups');
    expect(readFileSync(join(b, 'wa-auth-20261009', 'creds.json'), 'utf8')).toBe('{"a":1}');
    expect(readFileSync(join(b, 'wa-auth-inboxes-20261009', '2', 'creds.json'), 'utf8')).toBe(
      '{"two":1}',
    );
    // the sources stay where they are, byte for byte
    expect(readFileSync(join(dir, 'wa-auth', 'creds.json')).equals(before)).toBe(true);
    expect(existsSync(join(dir, 'wa-auth-inboxes', '2', 'creds.json'))).toBe(true);
    // both kinds are pruned to the newest 7, and one kind never counts the other
    const names = readdirSync(b).sort();
    expect(names.filter((n) => /^wa-auth-\d{8}$/.test(n))).toHaveLength(7);
    const inboxes = names.filter((n) => /^wa-auth-inboxes-\d{8}$/.test(n));
    expect(inboxes).toHaveLength(7);
    expect(inboxes[0]).toBe('wa-auth-inboxes-20261003');
  });

  it('never ages out a daily inboxes copy as if it were a labelled one (RF-5)', () => {
    const b = join(dir, 'backups');
    // the app was off for weeks: the newest daily copies are older than the pre-merge cutoff
    mkdirSync(join(b, 'wa-auth-inboxes-20260801', '2'), { recursive: true });
    mkdirSync(join(b, 'wa-auth-20260801'), { recursive: true });
    writeFileSync(join(b, 'app-20260801.db'), '');
    runBackupSync(dir, db, new Date(2026, 9, 9, 3, 0));
    expect(existsSync(join(b, 'wa-auth-inboxes-20260801', '2'))).toBe(true);
    expect(existsSync(join(b, 'wa-auth-20260801'))).toBe(true);
    expect(existsSync(join(b, 'app-20260801.db'))).toBe(true);
  });

  it('labels and ages the inboxes folder of a pre-merge backup too', () => {
    mkdirSync(join(dir, 'wa-auth-inboxes', '2'), { recursive: true });
    writeFileSync(join(dir, 'wa-auth-inboxes', '2', 'creds.json'), '{}');
    runBackupSync(dir, db, new Date(2026, 9, 5, 9, 0), { label: 'premerge' });
    const b = join(dir, 'backups');
    expect(existsSync(join(b, 'wa-auth-inboxes-premerge-20261005-090000', '2', 'creds.json'))).toBe(
      true,
    );
    // a stamp taken by an inboxes copy alone is not reused
    rmSync(join(b, 'app-premerge-20261005-090000.db'));
    rmSync(join(b, 'wa-auth-premerge-20261005-090000'), { recursive: true });
    expect(runBackupSync(dir, db, new Date(2026, 9, 5, 9, 0), { label: 'premerge' })).toBe(
      join(b, 'app-premerge-20261005-090000-2.db'),
    );
    runBackupSync(dir, db, new Date(2026, 10, 5));
    expect(existsSync(join(b, 'wa-auth-inboxes-premerge-20261005-090000'))).toBe(false);
  });

  it('refuses to run inside a transaction', () => {
    expect(() => db.transaction(() => runBackupSync(dir, db, new Date(2026, 9, 5)))()).toThrow(
      /transaction/,
    );
  });
});

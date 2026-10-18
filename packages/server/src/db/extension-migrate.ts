import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './index.js';

/**
 * Applies an extension's NNN_*.sql files once each, in numeric order, each file in its own
 * transaction. Tracked per extension in extension_migrations, never in PRAGMA user_version
 * (that track belongs to core). Returns the versions applied by this call.
 */
export function migrateExtension(db: DB, name: string, dir: string): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS extension_migrations (
    extension TEXT NOT NULL,
    version INTEGER NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (extension, version)
  )`);
  const byVersion = new Map<number, string>();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const version = parseInt(f, 10);
    const other = byVersion.get(version);
    if (other)
      throw new Error(`extension "${name}": migrations ${other} and ${f} share number ${version}`);
    byVersion.set(version, f);
  }
  const applied = new Set(
    db
      .prepare('SELECT version FROM extension_migrations WHERE extension = ?')
      .pluck()
      .all(name) as number[],
  );
  const record = db.prepare(
    'INSERT INTO extension_migrations (extension, version, applied_at) VALUES (?, ?, ?)',
  );
  const done: number[] = [];
  for (const version of [...byVersion.keys()].sort((a, b) => a - b)) {
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, byVersion.get(version)!), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(name, version, Date.now());
    })();
    done.push(version);
  }
  return done;
}

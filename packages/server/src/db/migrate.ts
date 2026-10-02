import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './index.js';

/**
 * Locate the migrations directory. In source (tsx/vitest) it sits next to this file.
 * In a tsc build (dist/db/migrate.js) .sql files are not copied, so fall back to
 * ../../src/db/migrations. WATI_MIGRATIONS_DIR overrides both (used by bundled builds).
 */
export function migrationsDir(): string {
  const env = process.env.WATI_MIGRATIONS_DIR;
  if (env && existsSync(env)) return env;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'migrations'), join(here, '..', '..', 'src', 'db', 'migrations')];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`migrations directory not found (tried ${candidates.join(', ')})`);
}

/** Applies db/migrations/NNN_*.sql in order; PRAGMA user_version tracks the last applied number. */
export function migrate(db: DB): void {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const f of files) {
    const version = parseInt(f, 10);
    if (version <= current) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}

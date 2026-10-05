import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import { openDb } from './index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TABLES = [
  'users',
  'sessions',
  'chats',
  'contacts',
  'messages',
  'notes',
  'chat_events',
  'quick_replies',
  'push_subscriptions',
  'settings',
  'audit_log',
];

describe('migrate', () => {
  it('creates all tables and sets user_version to the latest migration', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    const cols = (db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('client_id');
    const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(userCols).toContain('locale');
    db.close();
  });

  it('is idempotent on second run', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare("INSERT INTO settings(key, value) VALUES ('a', '1')").run();
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare('SELECT count(*) AS n FROM settings').get()).toEqual({ n: 1 });
    db.close();
  });

  it('openDb enables WAL + foreign keys + busy_timeout and migrates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wati-db-'));
    try {
      const db = openDb(join(dir, 'app.db'));
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

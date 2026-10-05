import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, migrationsDir } from './migrate.js';
import { openDb } from './index.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
  'ai_documents',
  'ai_chat_state',
];

describe('migrate', () => {
  it('creates all tables and sets user_version to the latest migration', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    const cols = (db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('client_id');
    const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(userCols).toContain('locale');
    expect(userCols).toContain('kind');
    db.close();
  });

  it('is idempotent on second run', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare("INSERT INTO settings(key, value) VALUES ('a', '1')").run();
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(db.prepare('SELECT count(*) AS n FROM settings').get()).toEqual({ n: 1 });
    db.close();
  });

  it('upgrades a main-branch locale database while preserving existing users and their language', () => {
    const db = new Database(':memory:');
    try {
      db.exec(readFileSync(join(migrationsDir(), '001_init.sql'), 'utf8'));
      db.exec(readFileSync(join(migrationsDir(), '002_user_locale.sql'), 'utf8'));
      db.pragma('user_version = 2');
      db.prepare(
        "INSERT INTO users(username, display_name, password_hash, role, locale, created_at) VALUES ('existing', 'Existing', 'hash', 'agent', 'ms', 1)",
      ).run();
      migrate(db);
      expect(db.pragma('user_version', { simple: true })).toBe(3);
      expect(
        db.prepare("SELECT username, locale, kind FROM users WHERE username = 'existing'").get(),
      ).toEqual({ username: 'existing', locale: 'ms', kind: 'human' });
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'ai_chat_state'").get(),
      ).toEqual({ name: 'ai_chat_state' });
      expect(() => migrate(db)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('openDb enables WAL + foreign keys + busy_timeout and migrates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wati-db-'));
    try {
      const db = openDb(join(dir, 'app.db'));
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(db.pragma('user_version', { simple: true })).toBe(3);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

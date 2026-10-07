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
  'jid_aliases',
  'customer_profiles',
  'customer_tags',
];
const LATEST = 7;

describe('migrate', () => {
  it('creates all tables and sets user_version to the latest migration', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
    const cols = (db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('client_id');
    expect(cols).toEqual(
      expect.arrayContaining(['transcript', 'transcript_lang', 'transcript_status']),
    );
    const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(userCols).toContain('locale');
    expect(userCols).toContain('kind');
    db.close();
  });

  it('customer tables never cascade from chats (user-written data survives a chat delete)', () => {
    const db = new Database(':memory:');
    migrate(db);
    const fks = (t: string) =>
      (db.prepare(`PRAGMA foreign_key_list(${t})`).all() as Array<{ table: string }>).map(
        (f) => f.table,
      );
    expect(fks('customer_profiles')).toEqual(['users']);
    expect(fks('customer_tags')).toEqual([]);
    const cols = (
      db.prepare('PRAGMA table_info(customer_profiles)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('id');
    db.close();
  });

  it('is idempotent on second run', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare("INSERT INTO settings(key, value) VALUES ('a', '1')").run();
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
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
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
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

  it('turns stored AI documents into file context items with kind, size and dates', () => {
    const db = new Database(':memory:');
    try {
      for (const file of ['001_init.sql', '002_user_locale.sql', '003_ai_member.sql'])
        db.exec(readFileSync(join(migrationsDir(), file), 'utf8'));
      db.pragma('user_version = 3');
      db.prepare(
        "INSERT INTO ai_documents(name, size, text, created_at) VALUES ('hours.pdf', 2048, 'Open 9am', 1700)",
      ).run();
      migrate(db);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
      expect(
        db.prepare('SELECT name, kind, size, text, created_at, updated_at FROM ai_documents').get(),
      ).toEqual({
        name: 'hours.pdf',
        kind: 'file',
        size: 2048,
        text: 'Open 9am',
        created_at: 1700,
        updated_at: 1700,
      });
      expect(() =>
        db
          .prepare(
            "INSERT INTO ai_documents(name, kind, size, text, created_at, updated_at) VALUES ('x', 'note', 1, 'x', 1, 1)",
          )
          .run(),
      ).toThrow();
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
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('004 adds jid_aliases and backfills wa_remote_jid and chats.phone on an existing v3 database', () => {
    const db = new Database(':memory:');
    try {
      for (const f of ['001_init.sql', '002_user_locale.sql', '003_ai_member.sql']) {
        db.exec(readFileSync(join(migrationsDir(), f), 'utf8'));
      }
      db.pragma('user_version = 3');
      db.exec(`
        INSERT INTO chats (jid, type, name, updated_at) VALUES
          ('60111@s.whatsapp.net', 'dm', 'A', 1), ('999@lid', 'dm', '', 1),
          ('888@lid', 'dm', '', 1), ('1-2@g.us', 'group', 'G', 1);
        INSERT INTO contacts (jid, phone) VALUES ('999@lid', '60222'), ('888@lid', NULL);
        INSERT INTO messages (id, chat_jid, type, timestamp, created_at) VALUES
          ('m1', '60111@s.whatsapp.net', 'text', 1, 1), ('m2', '999@lid', 'text', 2, 2);
      `);
      migrate(db);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
      expect(db.prepare('SELECT id, wa_remote_jid FROM messages ORDER BY id').all()).toEqual([
        { id: 'm1', wa_remote_jid: '60111@s.whatsapp.net' },
        { id: 'm2', wa_remote_jid: '999@lid' },
      ]);
      expect(db.prepare('SELECT jid, phone FROM chats ORDER BY jid').all()).toEqual([
        { jid: '1-2@g.us', phone: null },
        { jid: '60111@s.whatsapp.net', phone: '60111' },
        { jid: '888@lid', phone: null },
        { jid: '999@lid', phone: '60222' },
      ]);
      expect(
        (db.prepare('PRAGMA table_info(jid_aliases)').all() as Array<{ name: string }>).map(
          (c) => c.name,
        ),
      ).toEqual(['alias_jid', 'canonical_jid', 'source', 'learned_at', 'repointed_from']);
      expect(() => migrate(db)).not.toThrow();
    } finally {
      db.close();
    }
  });
});

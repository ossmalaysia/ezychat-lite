import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from './index.js';
import { migrateExtension } from './extension-migrate.js';

let root: string;
let db: DB;
const dir = (name: string, files: Record<string, string>) => {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  for (const [f, sql] of Object.entries(files)) writeFileSync(join(d, f), sql);
  return d;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wati-extmig-'));
  db = openDb(join(root, 'app.db'));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('migrateExtension', () => {
  it('applies files in numeric order once and leaves user_version alone', () => {
    const before = db.pragma('user_version', { simple: true });
    const d = dir('ent', {
      '2_b.sql': 'INSERT INTO ent_t (v) VALUES (2);',
      '10_c.sql': 'INSERT INTO ent_t (v) VALUES (10);',
      '1_a.sql': 'CREATE TABLE ent_t (v INTEGER);',
      'README.md': 'ignored',
    });
    expect(migrateExtension(db, 'ent', d)).toEqual([1, 2, 10]);
    expect(migrateExtension(db, 'ent', d)).toEqual([]);
    expect(db.prepare('SELECT v FROM ent_t ORDER BY v').pluck().all()).toEqual([2, 10]);
    expect(db.pragma('user_version', { simple: true })).toBe(before);
  });

  it('keeps a separate track per extension', () => {
    migrateExtension(db, 'one', dir('one', { '1_a.sql': 'CREATE TABLE ent_one (v INTEGER);' }));
    expect(
      migrateExtension(db, 'two', dir('two', { '1_a.sql': 'CREATE TABLE ent_two (v INTEGER);' })),
    ).toEqual([1]);
  });

  it('rejects two files with the same number before applying anything', () => {
    const d = dir('dup', { '1_a.sql': 'CREATE TABLE ent_x (v INTEGER);', '01_b.sql': 'SELECT 1;' });
    expect(() => migrateExtension(db, 'dup', d)).toThrow(/1_a\.sql.*01_b\.sql|01_b\.sql.*1_a\.sql/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ent_x'").get()).toBeUndefined();
  });

  it('rolls back a failing file and keeps earlier versions recorded', () => {
    const d = dir('bad', {
      '1_ok.sql': 'CREATE TABLE ent_ok (v INTEGER);',
      '2_bad.sql': 'CREATE TABLE ent_half (v INTEGER); THIS IS NOT SQL;',
    });
    expect(() => migrateExtension(db, 'bad', d)).toThrow();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'ent_half'").get(),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT version FROM extension_migrations WHERE extension = 'bad'").pluck().all(),
    ).toEqual([1]);
  });
});

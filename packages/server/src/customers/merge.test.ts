import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/index.js';
import { mergeCustomerProfile } from './merge.js';
import { CustomerRepo } from './repo.js';

let db: DB;
let repo: CustomerRepo;
const PN = '60123@s.whatsapp.net';
const LID = '999@lid';
const empty = { name: null, company: null, email: null, otherPhone: null, address: null };

function user(id: number) {
  db.prepare(
    "INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', 'agent', 0)",
  ).run(id, `u${id}`, `U${id}`);
}

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'wati-cmerge-')), 'app.db'));
  repo = new CustomerRepo(db);
  for (const jid of [PN, LID])
    db.prepare("INSERT INTO chats (jid, type, name, updated_at) VALUES (?, 'dm', '', 0)").run(jid);
  user(1);
  user(2);
  user(3);
});
afterEach(() => db.close());

describe('mergeCustomerProfile', () => {
  it('moves a profile to a chat that has none', () => {
    repo.save(PN, { ...empty, name: 'Farah' }, ['VIP'], 3, 100);
    expect(mergeCustomerProfile(db, PN, LID)).toEqual({ profiles: 1, tags: 1, tagsDropped: 0 });
    expect(repo.get(LID)).toMatchObject({
      name: 'Farah',
      tags: ['VIP'],
      updatedBy: 3,
      updatedAt: 100,
    });
    expect(repo.get(PN)).toBeNull();
  });

  it('keeps the newest non-empty value per field and unions tags (max 10)', () => {
    repo.save(
      PN,
      { ...empty, name: 'Old name', email: 'only@pn.my' },
      ['VIP', 'a', 'b', 'c', 'd', 'e'],
      1,
      100,
    );
    repo.save(
      LID,
      { ...empty, name: 'New name', company: 'Co' },
      ['vip', 'f', 'g', 'h', 'i', 'j'],
      2,
      200,
    );
    expect(mergeCustomerProfile(db, PN, LID)).toEqual({ profiles: 1, tags: 10, tagsDropped: 1 });
    const merged = repo.get(LID)!;
    expect(merged).toMatchObject({
      name: 'New name',
      company: 'Co',
      email: 'only@pn.my',
      updatedAt: 200,
      updatedBy: 2,
    });
    expect(merged.tags).toHaveLength(10);
    expect(merged.tags.filter((tag) => tag.toLowerCase() === 'vip')).toHaveLength(1);
    expect(repo.get(PN)).toBeNull();
  });

  it('lets the newer phone-number profile win over an older LID profile', () => {
    repo.save(LID, { ...empty, name: 'Old', address: 'KL' }, [], 1, 100);
    repo.save(PN, { ...empty, name: 'Newer' }, [], 2, 300);
    mergeCustomerProfile(db, PN, LID);
    expect(repo.get(LID)).toMatchObject({
      name: 'Newer',
      address: 'KL',
      updatedAt: 300,
      updatedBy: 2,
    });
  });

  it('does nothing when neither chat has a profile', () => {
    expect(mergeCustomerProfile(db, PN, LID)).toEqual({ profiles: 0, tags: 0, tagsDropped: 0 });
    expect(repo.get(LID)).toBeNull();
  });

  it('leaves the target alone when only the target has a profile', () => {
    repo.save(LID, { ...empty, name: 'Kept' }, ['VIP'], 1, 100);
    expect(mergeCustomerProfile(db, PN, LID)).toEqual({ profiles: 0, tags: 0, tagsDropped: 0 });
    expect(repo.get(LID)).toMatchObject({ name: 'Kept', tags: ['VIP'] });
  });
});

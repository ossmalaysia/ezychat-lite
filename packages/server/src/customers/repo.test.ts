import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/index.js';
import { CustomerRepo } from './repo.js';

let db: DB;
let repo: CustomerRepo;
const A = '601@s.whatsapp.net';
const B = '602@s.whatsapp.net';
const C = '603@s.whatsapp.net';
const empty = { name: null, company: null, email: null, otherPhone: null, address: null };

function chat(jid: string) {
  db.prepare("INSERT INTO chats (jid, type, name, updated_at) VALUES (?, 'dm', '', 0)").run(jid);
}

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'wati-cust-')), 'app.db'));
  repo = new CustomerRepo(db);
  chat(A);
  chat(B);
  chat(C);
});
afterEach(() => db.close());

describe('CustomerRepo', () => {
  it('returns null for a chat without a profile, then the saved profile', () => {
    expect(repo.get(A)).toBeNull();
    repo.save(A, { ...empty, name: 'Farah', email: 'f@x.co' }, ['VIP'], null, 1000);
    expect(repo.get(A)).toEqual({
      ...empty,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Farah',
      email: 'f@x.co',
      tags: ['VIP'],
      updatedAt: 1000,
      updatedBy: null,
    });
  });

  it('dedupes tags ignoring case and reuses the spelling already in use', () => {
    repo.save(A, empty, ['VIP'], null, 1);
    expect(repo.canonicalTags([' vip ', 'Wholesale', 'WHOLESALE', 'vIp'])).toEqual([
      'VIP',
      'Wholesale',
    ]);
  });

  it('keeps one spelling for " VIP ", "vip" and "Vip" typed on different customers', () => {
    repo.save(A, empty, repo.canonicalTags([' VIP ']), null, 1);
    repo.save(B, empty, repo.canonicalTags(['vip']), null, 2);
    repo.save(C, empty, repo.canonicalTags(['Vip']), null, 3);
    expect([repo.tags(A), repo.tags(B), repo.tags(C)]).toEqual([['VIP'], ['VIP'], ['VIP']]);
    expect(repo.suggest(undefined)).toEqual(['VIP']);
  });

  it('caps tags at 10', () => {
    expect(repo.canonicalTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(10);
  });

  it('replaces tags on save and suggests by prefix, most used first', () => {
    repo.save(A, empty, ['VIP', 'Wholesale'], null, 1);
    repo.save(B, empty, ['VIP'], null, 2);
    expect(repo.suggest('v')).toEqual(['VIP']);
    expect(repo.suggest(undefined)).toEqual(['VIP', 'Wholesale']);
    repo.save(A, empty, ['Halal'], null, 3);
    expect(repo.tags(A)).toEqual(['Halal']);
  });

  it('treats LIKE wildcards in the suggestion prefix literally', () => {
    repo.save(A, empty, ['VIP', '50%_off'], null, 1);
    expect(repo.suggest('%')).toEqual([]);
    expect(repo.suggest('_')).toEqual([]);
    expect(repo.suggest('\\')).toEqual([]);
    expect(repo.suggest('50%')).toEqual(['50%_off']);
  });

  it('maps chats to profile names, skipping unnamed profiles', () => {
    repo.save(A, { ...empty, name: 'Farah' }, [], null, 1);
    repo.save(B, { ...empty, company: 'Only company' }, [], null, 1);
    expect(repo.namesByChat([A, B, '609@s.whatsapp.net'])).toEqual(new Map([[A, 'Farah']]));
    expect(repo.namesByChat([])).toEqual(new Map());
  });

  it('keeps the profile when its chat row is deleted (user data never cascades)', () => {
    repo.save(A, { ...empty, name: 'Farah' }, ['VIP'], null, 1);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(A);
    expect(repo.get(A)).toMatchObject({ name: 'Farah', tags: ['VIP'] });
    expect(repo.suggest(undefined)).toEqual(['VIP']);
  });

  it('gives a profile a stable id on first save that later saves never change', () => {
    repo.save(A, { ...empty, name: 'Farah' }, [], null, 1);
    const id = repo.get(A)!.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    repo.save(A, { ...empty, name: 'Farah R' }, ['VIP'], null, 2);
    expect(repo.get(A)!.id).toBe(id);
    repo.save(B, { ...empty, name: 'Other' }, [], null, 3);
    expect(repo.get(B)!.id).not.toBe(id);
  });

  it("lets a customer change the casing of a tag only they use, but keeps other customers' spelling", () => {
    repo.save(A, empty, ['vip'], null, 1);
    expect(repo.canonicalTags(['VIP'], A)).toEqual(['VIP']);
    repo.save(A, empty, repo.canonicalTags(['VIP'], A), null, 2);
    expect(repo.tags(A)).toEqual(['VIP']);
    repo.save(B, empty, ['Wholesale'], null, 3);
    expect(repo.canonicalTags(['wholesale', 'Vip'], A)).toEqual(['Wholesale', 'Vip']);
  });
});

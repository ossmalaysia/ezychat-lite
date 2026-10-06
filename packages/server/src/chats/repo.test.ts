import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/index.js';
import { CustomerRepo } from '../customers/repo.js';
import { ChatRepo, rowToChat, type ChatColumns } from './repo.js';

let db: DB;
let chats: ChatRepo;
let customers: CustomerRepo;
const empty = { name: null, company: null, email: null, otherPhone: null, address: null };
const jid = (i: number) => `601${String(i).padStart(4, '0')}@s.whatsapp.net`;

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'wati-chatrepo-')), 'app.db'));
  chats = new ChatRepo(db);
  customers = new CustomerRepo(db);
});
afterEach(() => db.close());

describe('ChatRepo with customer profiles', () => {
  it('lists the right tags, in order, for many chats', () => {
    for (let i = 0; i < 60; i++) {
      chats.ensure(jid(i), { name: `C${i}` }, i);
      chats.update(jid(i), { last_message_at: i });
      if (i % 3 === 0) customers.save(jid(i), empty, [`t${i}`, `shared`], null, 1000 + i * 10);
    }
    const rows = chats.list({ assigned: 'any', userId: 1, limit: 100 });
    expect(rows).toHaveLength(60);
    for (const r of rows) {
      const i = Number(r.jid.slice(3, 7));
      expect(rowToChat(r).tags).toEqual(i % 3 === 0 ? [`t${i}`, 'shared'] : []);
    }
    expect(rowToChat(chats.get(jid(3))!).tags).toEqual(['t3', 'shared']);
    expect(rowToChat(chats.get(jid(4))!).tags).toEqual([]);
  });

  it('reads tags with one batched query, never a per-row subquery', () => {
    for (let i = 0; i < 5; i++) chats.ensure(jid(i), { name: `C${i}` }, i);
    customers.save(jid(1), empty, ['VIP'], null, 1);
    const seen: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      seen.push(sql);
      return prepare(sql);
    }) as typeof db.prepare;
    chats.list({ assigned: 'any', userId: 1, limit: 50 });
    chats.get(jid(1));
    const tagReads = seen.filter((s) => /FROM customer_tags/.test(s) && /\btag\b/.test(s));
    expect(tagReads.every((s) => /chat_jid IN \(/.test(s))).toBe(true);
    expect(tagReads).toHaveLength(2);
    expect(seen.some((s) => /chat_jid = c\.jid ORDER BY/.test(s))).toBe(false);
  });

  it('only accepts rows that carry the joined profile columns', () => {
    chats.ensure(jid(1), { name: 'A' }, 1);
    const raw = db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid(1)) as ChatColumns;
    // Compile-time check only (typecheck fails if a raw row were accepted).
    // @ts-expect-error a raw chats row lacks profile_name/profile_tags
    const misuse = () => rowToChat(raw);
    expect(typeof misuse).toBe('function');
    const plain: ChatColumns[] = chats.directChats();
    expect(plain.map((c) => c.jid)).toEqual([jid(1)]);
  });
});

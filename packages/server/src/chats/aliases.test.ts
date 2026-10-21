import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { migrate } from '../db/migrate.js';
import { AliasStore, normalizeLid, normalizePn, orientPair } from './aliases.js';
import { ChatRepo } from './repo.js';

const PN = '60111111111@s.whatsapp.net';
const PN2 = '60222222222@s.whatsapp.net';
const LID = '123456789@lid';
const OTHER_LID = '987654321@lid';
const ME = '60000000000@s.whatsapp.net';

let db: Database.Database;
let clock: number;
let warn: ReturnType<typeof vi.fn>;
const store = () =>
  new AliasStore(db, {
    ownJid: () => ME,
    now: () => clock,
    log: { warn, info: vi.fn() } as unknown as Pick<Logger, 'warn' | 'info'>,
  });
const chat = (jid: string, phone: string | null = null) =>
  db
    .prepare("INSERT INTO chats (jid, type, name, updated_at, phone) VALUES (?, 'dm', '', 1, ?)")
    .run(jid, phone);
const phoneOf = (jid: string) =>
  (db.prepare('SELECT phone FROM chats WHERE jid = ?').get(jid) as { phone: string | null }).phone;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  clock = 1000;
  warn = vi.fn();
});

describe('orientPair / normalize', () => {
  it('orients explicit pairs as {pn, lid} in either order and strips device suffixes', () => {
    expect(orientPair({ jid: PN, alias: LID })).toEqual({ pn: PN, lid: LID });
    expect(orientPair({ jid: '123456789:4@lid', alias: '60111111111:2@s.whatsapp.net' })).toEqual({
      pn: PN,
      lid: LID,
    });
    expect(normalizePn('60111111111@c.us')).toBe(PN);
    expect(normalizeLid('123456789:9@lid')).toBe(LID);
  });

  it('rejects groups, broadcasts, two PNs, two LIDs and malformed ids', () => {
    const bad: Array<[string, string]> = [
      [PN, '1203@g.us'],
      [PN, 'status@broadcast'],
      [PN, PN2],
      [LID, OTHER_LID],
      [PN, 'letters@lid'],
    ];
    for (const [jid, alias] of bad) expect(orientPair({ jid, alias })).toBeNull();
  });
});

describe('AliasStore', () => {
  it('resolves unknown JIDs to themselves and a learned PN (with or without device) to its LID', () => {
    const s = store();
    expect(s.resolve(PN)).toBe(PN);
    expect(s.learn({ jid: LID, alias: PN }, 'message')).toEqual({
      kind: 'added',
      pn: PN,
      lid: LID,
    });
    expect(s.resolve(PN)).toBe(LID);
    expect(s.resolve('60111111111:3@s.whatsapp.net')).toBe(LID);
    expect(s.resolve(LID)).toBe(LID);
    expect(s.resolve('1203@g.us')).toBe('1203@g.us');
    expect(s.group(PN)).toEqual([LID, PN]);
  });

  it('rule 1: stores a new pair with its source and sets the phone on the LID chat', () => {
    chat(LID);
    store().learn({ jid: PN, alias: LID }, 'lid-mapping');
    expect(db.prepare('SELECT * FROM jid_aliases').all()).toEqual([
      {
        alias_jid: PN,
        canonical_jid: LID,
        source: 'lid-mapping',
        learned_at: 1000,
        repointed_from: null,
      },
    ]);
    expect(phoneOf(LID)).toBe('60111111111');
  });

  it('a pair from stale history never re-points a known number; live evidence does', () => {
    const s = store();
    const lidA = '111111@lid';
    const lidB = '222222@lid';
    s.learn({ jid: PN, alias: lidA }, 'message');
    expect(s.learn({ jid: PN, alias: lidB }, 'history')).toEqual({
      kind: 'unchanged',
      pn: PN,
      lid: lidA,
    });
    expect(s.resolve(PN)).toBe(lidA);
    expect(db.prepare('SELECT repointed_from FROM jid_aliases').get()).toEqual({
      repointed_from: null,
    });
    expect(s.learn({ jid: PN, alias: lidB }, 'message')).toMatchObject({ kind: 'repointed' });
    expect(s.resolve(PN)).toBe(lidB);
  });

  it('rule 2: a known pair is a no-op', () => {
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    clock = 2000;
    expect(s.learn({ jid: PN, alias: LID }, 'message')).toEqual({
      kind: 'unchanged',
      pn: PN,
      lid: LID,
    });
    expect(db.prepare('SELECT source, learned_at FROM jid_aliases').get()).toEqual({
      source: 'contacts',
      learned_at: 1000,
    });
  });

  it('rule 3: a recycled number re-points future routing only, clears the old phone and warns', () => {
    chat(LID);
    chat(OTHER_LID);
    db.prepare("INSERT INTO contacts (jid, phone) VALUES (?, '60111111111')").run(LID);
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    expect(s.learn({ jid: PN, alias: OTHER_LID }, 'message')).toEqual({
      kind: 'repointed',
      pn: PN,
      lid: OTHER_LID,
      previous: LID,
    });
    expect(s.resolve(PN)).toBe(OTHER_LID);
    expect(phoneOf(LID)).toBeNull();
    expect(phoneOf(OTHER_LID)).toBe('60111111111');
    expect(db.prepare('SELECT phone FROM contacts WHERE jid = ?').get(LID)).toEqual({
      phone: null,
    });
    expect(s.aliasesOf(LID)).toEqual([]);
    expect(s.aliasesOf(OTHER_LID)).toEqual([PN]);
    expect(
      db.prepare('SELECT repointed_from FROM jid_aliases WHERE alias_jid = ?').get(PN),
    ).toEqual({
      repointed_from: LID,
    });
    expect(warn).toHaveBeenCalledWith(
      { pn: PN, from: LID, to: OTHER_LID, source: 'message' },
      'phone number moved to a different WhatsApp ID',
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM chats').get()).toEqual({ n: 2 });
  });

  it('rule 4 and own number: never stores LID↔LID, groups, or the linked number', () => {
    const s = store();
    expect(s.learn({ jid: LID, alias: OTHER_LID }, 'contacts')).toEqual({ kind: 'ignored' });
    expect(s.learn({ jid: '1203@g.us', alias: LID }, 'contacts')).toEqual({ kind: 'ignored' });
    expect(s.learn({ jid: ME, alias: LID }, 'contacts')).toEqual({ kind: 'ignored' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM jid_aliases').get()).toEqual({ n: 0 });
  });

  it('keeps every old number of one person pointing at the same LID', () => {
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    s.learn({ jid: PN2, alias: LID }, 'contacts');
    expect(s.aliasesOf(LID)).toEqual([PN, PN2]);
    expect(s.group(LID)).toEqual([LID, PN, PN2]);
  });

  it('route: the LID chat first, else an existing phone-number chat of the person, else the LID; never writes chats', () => {
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    expect(s.route(PN)).toBe(LID); // no chat yet: new chats are LID-keyed
    expect(s.route(LID)).toBe(LID);
    chat(PN);
    expect(s.route(LID)).toBe(PN); // only the PN chat exists: the LID joins it until the next start
    expect(s.route(PN)).toBe(PN);
    chat(LID);
    expect(s.route(PN)).toBe(LID); // both exist (pair learned at runtime): the LID chat wins
    expect(s.route('60999999999@s.whatsapp.net')).toBe('60999999999@s.whatsapp.net');
    expect(s.route('555@lid')).toBe('555@lid');
    expect(s.route('1203@g.us')).toBe('1203@g.us');
    expect(s.route('customer@s.whatsapp.net')).toBe('customer@s.whatsapp.net');
    expect(db.prepare('SELECT COUNT(*) AS n FROM chats').get()).toEqual({ n: 2 });
  });

  it('a re-pointed number never routes the new person into, or merges, the old phone-number chat', () => {
    chat(PN);
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    s.learn({ jid: PN, alias: OTHER_LID }, 'message');
    expect(s.route(PN)).toBe(OTHER_LID);
    expect(s.route(OTHER_LID)).toBe(OTHER_LID);
    expect(s.pendingMerges()).toEqual([]);
    expect(store().route(OTHER_LID)).toBe(OTHER_LID); // survives a reload
  });

  it('reloads the routing table from the database', () => {
    store().learn({ jid: PN, alias: LID }, 'keystore');
    expect(store().resolve(PN)).toBe(LID);
    expect(store().aliasesOf(LID)).toEqual([PN]);
  });

  it('reads the own numbers once per batch, and again on every call outside one', () => {
    const ownJids = vi.fn(() => [ME]);
    const s = new AliasStore(db, {
      ownJids,
      now: () => clock,
      log: { warn, info: vi.fn() } as unknown as Pick<Logger, 'warn' | 'info'>,
    });
    const outcomes = s.batch(() => [
      s.learn({ jid: PN, alias: LID }, 'contacts'),
      s.learn({ jid: PN2, alias: OTHER_LID }, 'contacts'),
      s.batch(() => s.learn({ jid: ME, alias: '555@lid' }, 'contacts')),
    ]);
    expect(outcomes.map((o) => o.kind)).toEqual(['added', 'added', 'ignored']);
    expect(ownJids).toHaveBeenCalledTimes(1);
    s.learn({ jid: PN, alias: LID }, 'contacts');
    s.learn({ jid: PN2, alias: OTHER_LID }, 'contacts');
    expect(ownJids).toHaveBeenCalledTimes(3);
    // a throwing batch never leaves a stale own set behind
    expect(() =>
      s.batch(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    ownJids.mockReturnValue([ME, '60333333333@s.whatsapp.net']);
    expect(s.learn({ jid: '60333333333@s.whatsapp.net', alias: '777@lid' }, 'contacts')).toEqual({
      kind: 'ignored',
    });
  });

  it('finds the chats of a WhatsApp JID in every inbox by primary key, never by a table scan', () => {
    db.prepare(
      "INSERT INTO inboxes (id, name, tone, auth_dir, created_at) VALUES (2, 'Two', 'info', 'wa-auth-inboxes/2', 1)",
    ).run();
    chat(LID); // inbox 1, written before wa_jid existed
    db.prepare(
      "INSERT INTO chats (jid, type, name, updated_at, inbox_id, wa_jid) VALUES (?, 'dm', '', 1, 2, NULL)",
    ).run(`${LID}#2`);
    const seen: string[] = [];
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      seen.push(sql);
      return prepare(sql);
    }) as typeof db.prepare);
    const repo = new ChatRepo(db);
    expect(repo.keysOf(LID)).toEqual([LID, `${LID}#2`]);
    expect(repo.keysOf('nobody@lid')).toEqual([]);
    chat(PN);
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts'); // both chats exist: hasAnyChat on each
    s.learn({ jid: PN, alias: OTHER_LID }, 'message'); // re-point: clears the old phone
    expect(phoneOf(LID)).toBeNull();
    expect(phoneOf(`${LID}#2`)).toBeNull();
    vi.mocked(db.prepare).mockRestore();
    const chatQueries = [...new Set(seen)].filter((q) => /\b(FROM|UPDATE) chats\b/.test(q));
    expect(chatQueries.length).toBeGreaterThanOrEqual(3);
    for (const q of chatQueries) {
      const params = Array.from({ length: (q.match(/\?/g) ?? []).length }, () => null);
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${q}`).all(...params) as Array<{
        detail: string;
      }>;
      expect(plan.map((p) => p.detail).join('\n'), q).not.toMatch(/\bSCAN (c|chats)\b/);
    }
  });

  it('shows a learned number on the WhatsApp ID chat of every inbox', () => {
    db.prepare(
      "INSERT INTO inboxes (id, name, tone, auth_dir, created_at) VALUES (2, 'Two', 'info', 'wa-auth-inboxes/2', 1)",
    ).run();
    chat(LID);
    db.prepare(
      "INSERT INTO chats (jid, type, name, updated_at, inbox_id, wa_jid) VALUES (?, 'dm', '', 1, 2, ?)",
    ).run(`${LID}#2`, LID);
    store().learn({ jid: PN, alias: LID }, 'contacts');
    expect(phoneOf(LID)).toBe('60111111111');
    expect(phoneOf(`${LID}#2`)).toBe('60111111111');
  });

  it('lists aliases that still have their own chat row as pending merges', () => {
    chat(PN);
    chat(LID);
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    expect(s.pendingMerges()).toEqual([{ inboxId: 1, from: PN, to: LID }]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from '../db/index.js';
import { CustomerRepo } from '../customers/repo.js';
import { mergeChat } from './merge.js';
import type { ChatRow } from './repo.js';

const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
let dir: string;
let db: DB;

type Seed = Partial<
  Pick<
    ChatRow,
    | 'name'
    | 'avatar_path'
    | 'unread_count'
    | 'last_message_at'
    | 'last_message_preview'
    | 'status'
    | 'assigned_to'
    | 'phone'
  >
>;

function seedChat(jid: string, f: Seed = {}): void {
  db.prepare(
    `INSERT INTO chats (jid, type, name, avatar_path, unread_count, last_message_at, last_message_preview,
       status, assigned_to, updated_at, phone)
     VALUES (@jid, 'dm', @name, @avatar_path, @unread_count, @last_message_at, @last_message_preview,
       @status, @assigned_to, 1, @phone)`,
  ).run({
    jid,
    name: 'Aisyah',
    avatar_path: null,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: null,
    status: 'open',
    assigned_to: null,
    phone: null,
    ...f,
  });
}

function seedMessages(jid: string, n: number, startTs: number): void {
  const ins = db.prepare(
    `INSERT INTO messages (id, chat_jid, from_me, type, body, timestamp, created_at, wa_remote_jid)
     VALUES (?, ?, 0, 'text', ?, ?, ?, ?)`,
  );
  for (let i = 0; i < n; i++) ins.run(`${jid}#${i}`, jid, `m${i}`, startTs + i, startTs + i, jid);
}

const count = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;
const chat = (jid: string) =>
  db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid) as ChatRow | undefined;
const aiState = (jid: string, f: { paused?: number; customer: string; dueAt: number | null }) =>
  db
    .prepare(
      `INSERT INTO ai_chat_state (chat_jid, paused, awaiting_confirmation, last_customer_message_id, due_at)
       VALUES (?, ?, 1, ?, ?)`,
    )
    .run(jid, f.paused ?? 0, f.customer, f.dueAt);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wati-merge-'));
  db = openDb(join(dir, 'app.db'));
  const user = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, 'x', 'agent', 1)",
  );
  user.run('u1', 'U1');
  user.run('u2', 'U2');
  // id 3: the AI Sales Agent member (#18; at most one `kind = 'ai'` user, always an agent)
  db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role, kind, created_at) VALUES ('ai-1', 'Sales Agent', '', 'agent', 'ai', 1)",
  ).run();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('mergeChat', () => {
  it('merges the live shape: 64 PN + 5 LID messages, events, notes, a pending send and media rows', () => {
    seedChat(PN, {
      unread_count: 2,
      last_message_at: 1063,
      last_message_preview: 'pn last',
      status: 'resolved',
      phone: '60111111111',
    });
    seedChat(LID, {
      unread_count: 1,
      last_message_at: 2004,
      last_message_preview: 'lid last',
      avatar_path: 'lid.jpg',
    });
    seedMessages(PN, 64, 1000);
    seedMessages(LID, 5, 2000);
    db.prepare(
      `INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, status, timestamp, created_at,
         client_id, wa_remote_jid)
       VALUES ('local-c1', ?, 1, 1, 'text', 'queued', 'pending', 1500, 1500, 'c1', ?)`,
    ).run(PN, PN);
    db.prepare(
      `INSERT INTO messages (id, chat_jid, type, media_path, media_mime, media_status, timestamp, created_at,
         wa_remote_jid)
       VALUES ('pn-media', ?, 'image', 'pn-folder/pn-media.jpg', 'image/jpeg', 'ok', 900, 900, ?)`,
    ).run(PN, PN);
    db.prepare(
      "INSERT INTO chat_events (chat_jid, type, payload, at) VALUES (?, 'resolved', '{}', 1100)",
    ).run(PN);
    db.prepare(
      "INSERT INTO notes (chat_jid, user_id, body, created_at) VALUES (?, 1, 'VIP', 1200)",
    ).run(PN);

    const r = mergeChat(db, PN, LID, { now: 5000 });

    expect(r).toEqual({
      from: PN,
      to: LID,
      rekeyed: false,
      moved: {
        messages: 66,
        events: 1,
        notes: 1,
        aiState: 0,
        profiles: 0,
        tags: 0,
        tagsDropped: 0,
      },
      assignedTo: null,
      assigneeDropped: null,
    });
    expect(chat(PN)).toBeUndefined();
    expect(chat(LID)).toMatchObject({
      unread_count: 3,
      last_message_at: 2004,
      last_message_preview: 'lid last',
      status: 'open',
      avatar_path: 'lid.jpg',
      phone: '60111111111',
      name: 'Aisyah',
      updated_at: 5000,
    });
    expect(count('SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ?', LID)).toBe(71);
    expect(
      db
        .prepare("SELECT chat_jid, wa_remote_jid, status FROM messages WHERE id = 'local-c1'")
        .get(),
    ).toEqual({ chat_jid: LID, wa_remote_jid: PN, status: 'pending' });
    expect(db.prepare("SELECT media_path FROM messages WHERE id = 'pn-media'").get()).toEqual({
      media_path: 'pn-folder/pn-media.jpg',
    });
    expect(count('SELECT COUNT(*) AS n FROM chat_events WHERE chat_jid = ?', LID)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM notes WHERE chat_jid = ?', LID)).toBe(1);
    const auditRow = db
      .prepare("SELECT user_id, meta FROM audit_log WHERE action = 'chat.merge'")
      .get() as { user_id: number | null; meta: string };
    expect(auditRow.user_id).toBeNull();
    expect(JSON.parse(auditRow.meta)).toEqual({
      from: PN,
      to: LID,
      rekeyed: false,
      moved: {
        messages: 66,
        events: 1,
        notes: 1,
        aiState: 0,
        profiles: 0,
        tags: 0,
        tagsDropped: 0,
      },
      assigneeDropped: null,
    });
  });

  it('takes the newer last message and stays open when either chat is open', () => {
    seedChat(PN, { last_message_at: 3000, last_message_preview: 'newer on PN', status: 'open' });
    seedChat(LID, {
      last_message_at: 2000,
      last_message_preview: 'older on LID',
      status: 'resolved',
    });
    mergeChat(db, PN, LID, { now: 5000 });
    expect(chat(LID)).toMatchObject({
      last_message_at: 3000,
      last_message_preview: 'newer on PN',
      status: 'open',
    });
  });

  it('stays resolved only when both chats are resolved', () => {
    seedChat(PN, { status: 'resolved' });
    seedChat(LID, { status: 'resolved' });
    mergeChat(db, PN, LID, { now: 5000 });
    expect(chat(LID)!.status).toBe('resolved');
  });

  it.each([
    { pnOwner: 1, lidOwner: 1, pnNewest: true, kept: 1, dropped: null },
    { pnOwner: null, lidOwner: 2, pnNewest: true, kept: 2, dropped: null },
    { pnOwner: 1, lidOwner: null, pnNewest: false, kept: 1, dropped: null },
    { pnOwner: 1, lidOwner: 2, pnNewest: true, kept: 1, dropped: 2 },
    { pnOwner: 1, lidOwner: 2, pnNewest: false, kept: 2, dropped: 1 },
    // 3 = the AI Sales Agent: a teammate always wins, whichever chat is newer
    { pnOwner: 3, lidOwner: 2, pnNewest: true, kept: 2, dropped: 3 },
    { pnOwner: 1, lidOwner: 3, pnNewest: false, kept: 1, dropped: 3 },
    { pnOwner: 3, lidOwner: null, pnNewest: false, kept: 3, dropped: null },
  ])(
    'one owner: PN=$pnOwner LID=$lidOwner (PN has newest inbound: $pnNewest) keeps $kept',
    ({ pnOwner, lidOwner, pnNewest, kept, dropped }) => {
      seedChat(PN, { assigned_to: pnOwner });
      seedChat(LID, { assigned_to: lidOwner });
      seedMessages(PN, 1, pnNewest ? 3000 : 1000);
      seedMessages(LID, 1, 2000);
      const r = mergeChat(db, PN, LID, { now: 5000 })!;
      expect(chat(LID)!.assigned_to).toBe(kept);
      expect(r.assignedTo).toBe(kept);
      expect(r.assigneeDropped).toBe(dropped);
      const events = (
        db
          .prepare(
            "SELECT actor_id, payload, at FROM chat_events WHERE chat_jid = ? AND type = 'assigned'",
          )
          .all(LID) as Array<{ actor_id: number | null; payload: string; at: number }>
      ).map((e) => ({ ...e, payload: JSON.parse(e.payload) as unknown }));
      if (dropped === null) {
        expect(events).toEqual([]);
      } else {
        expect(events).toEqual([
          {
            actor_id: null,
            payload: { assignedTo: kept, previous: dropped, reason: 'merge' },
            at: 5000,
          },
        ]);
        const meta = db.prepare("SELECT meta FROM audit_log WHERE action = 'chat.merge'").get() as {
          meta: string;
        };
        expect(JSON.parse(meta.meta).assigneeDropped).toBe(dropped);
      }
    },
  );

  it.each([
    { savedOn: PN, pnName: 'Push Aisyah', lidName: 'Other', expected: 'Saved Aisyah' },
    { savedOn: null, pnName: 'Aisyah Real', lidName: '', expected: 'Aisyah Real' },
    { savedOn: null, pnName: '60111111111', lidName: '123456789', expected: '123456789' },
  ])(
    'name: saved contact > real name > LID chat name ($expected)',
    ({ savedOn, pnName, lidName, expected }) => {
      seedChat(PN, { name: pnName });
      seedChat(LID, { name: lidName });
      if (savedOn)
        db.prepare("INSERT INTO contacts (jid, saved_name) VALUES (?, 'Saved Aisyah')").run(
          savedOn,
        );
      mergeChat(db, PN, LID, { now: 5000 });
      expect(chat(LID)!.name).toBe(expected);
    },
  );

  it('re-keys the phone-number chat when the WhatsApp ID has no chat yet', () => {
    seedChat(PN, {
      name: '60111111111',
      unread_count: 4,
      assigned_to: 2,
      last_message_at: 10,
      last_message_preview: 'hi',
    });
    seedMessages(PN, 3, 1);
    const r = mergeChat(db, PN, LID, { now: 5000 })!;
    expect(r).toMatchObject({
      rekeyed: true,
      moved: { messages: 3, events: 0, notes: 0, aiState: 0, profiles: 0, tags: 0, tagsDropped: 0 },
    });
    expect(chat(PN)).toBeUndefined();
    expect(chat(LID)).toMatchObject({
      type: 'dm',
      name: '',
      unread_count: 4,
      assigned_to: 2,
      last_message_at: 10,
      last_message_preview: 'hi',
      phone: '60111111111',
      updated_at: 5000,
    });
  });

  it('re-keying keeps the contact name when the phone-number chat only had a fallback name', () => {
    seedChat(PN, { name: '60111111111', last_message_at: 10 });
    db.prepare(
      "INSERT INTO contacts (jid, saved_name, push_name) VALUES (?, 'Saved Aisyah', 'Aisyah')",
    ).run(PN);
    mergeChat(db, PN, LID, { now: 5000 });
    expect(chat(LID)).toMatchObject({ name: 'Saved Aisyah' });
  });

  it('re-keying falls back to the WhatsApp push name when there is no saved name', () => {
    seedChat(PN, { name: '60111111111', last_message_at: 10 });
    db.prepare("INSERT INTO contacts (jid, push_name) VALUES (?, 'Aisyah')").run(PN);
    mergeChat(db, PN, LID, { now: 5000 });
    expect(chat(LID)).toMatchObject({ name: 'Aisyah' });
  });

  it('is idempotent: a second run finds nothing to merge', () => {
    seedChat(PN);
    seedChat(LID);
    expect(mergeChat(db, PN, LID, { now: 5000 })).not.toBeNull();
    expect(mergeChat(db, PN, LID, { now: 6000 })).toBeNull();
    expect(mergeChat(db, LID, LID, { now: 6000 })).toBeNull();
    expect(count('SELECT COUNT(*) AS n FROM audit_log')).toBe(1);
  });

  it('rolls back everything when a statement inside the merge fails', () => {
    seedChat(PN);
    seedChat(LID);
    seedMessages(PN, 2, 1);
    db.exec(
      "CREATE TRIGGER fail_merge BEFORE DELETE ON chats BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    );
    expect(() => mergeChat(db, PN, LID, { now: 5000 })).toThrow('boom');
    expect(chat(PN)).toBeDefined();
    expect(count('SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ?', PN)).toBe(2);
    expect(count('SELECT COUNT(*) AS n FROM audit_log')).toBe(0);
  });

  it("moves the AI Sales Agent's chat state with a re-keyed phone-number chat", () => {
    seedChat(PN, { assigned_to: 3 });
    seedMessages(PN, 1, 1000);
    aiState(PN, { customer: `${PN}#0`, dueAt: 9000 });
    const r = mergeChat(db, PN, LID, { now: 5000 })!;
    expect(r.moved.aiState).toBe(1);
    expect(chat(LID)!.assigned_to).toBe(3);
    expect(db.prepare('SELECT * FROM ai_chat_state').all()).toEqual([
      {
        chat_jid: LID,
        paused: 0,
        awaiting_confirmation: 1,
        last_customer_message_id: `${PN}#0`,
        last_replied_message_id: null,
        due_at: 9000,
      },
    ]);
  });

  it.each([
    { pnNewest: true, lidPaused: 0, paused: 0, customer: `${PN}#0`, dueAt: 9000, awaiting: 1 },
    { pnNewest: false, lidPaused: 0, paused: 0, customer: `${LID}#0`, dueAt: 8000, awaiting: 1 },
    { pnNewest: true, lidPaused: 1, paused: 1, customer: `${PN}#0`, dueAt: null, awaiting: 0 },
  ])(
    'keeps the newer AI state and stays paused if either chat was handed off (PN newest: $pnNewest, LID paused: $lidPaused)',
    ({ pnNewest, lidPaused, paused, customer, dueAt, awaiting }) => {
      seedChat(PN);
      seedChat(LID);
      seedMessages(PN, 1, pnNewest ? 3000 : 1000);
      seedMessages(LID, 1, 2000);
      aiState(PN, { customer: `${PN}#0`, dueAt: 9000 });
      aiState(LID, { paused: lidPaused, customer: `${LID}#0`, dueAt: 8000 });
      expect(mergeChat(db, PN, LID, { now: 5000 })!.moved.aiState).toBe(1);
      expect(db.prepare('SELECT * FROM ai_chat_state').all()).toEqual([
        {
          chat_jid: LID,
          paused,
          awaiting_confirmation: awaiting,
          last_customer_message_id: customer,
          last_replied_message_id: null,
          due_at: dueAt,
        },
      ]);
    },
  );
  it('pauses the merged AI state when a teammate takes the chat from the AI Sales Agent', () => {
    seedChat(PN, { assigned_to: 3 });
    seedChat(LID, { assigned_to: 2 });
    seedMessages(PN, 1, 3000);
    seedMessages(LID, 1, 2000);
    aiState(PN, { customer: `${PN}#0`, dueAt: 9000 });
    const r = mergeChat(db, PN, LID, { now: 5000 })!;
    expect(r).toMatchObject({ assignedTo: 2, assigneeDropped: 3 });
    expect(db.prepare('SELECT * FROM ai_chat_state').all()).toEqual([
      {
        chat_jid: LID,
        paused: 1,
        awaiting_confirmation: 0,
        last_customer_message_id: `${PN}#0`,
        last_replied_message_id: null,
        due_at: null,
      },
    ]);
  });

  describe('customer profiles', () => {
    const empty = { name: null, company: null, email: null, otherPhone: null, address: null };

    it('keeps a profile saved on the phone-number chat through the merge into the LID chat', () => {
      seedChat(PN);
      seedChat(LID);
      seedMessages(PN, 1, 1000);
      seedMessages(LID, 1, 2000);
      const repo = new CustomerRepo(db);
      repo.save(PN, { ...empty, name: 'Aisyah Rahman', email: 'a@pn.my' }, ['VIP'], 1, 300);
      repo.save(LID, { ...empty, name: 'Older', company: 'Co' }, ['vip', 'Wholesale'], 2, 100);
      const newerId = repo.get(PN)!.id;
      const r = mergeChat(db, PN, LID, { now: 5000 })!;
      expect(r.moved).toMatchObject({ profiles: 1, tags: 2, tagsDropped: 0 });
      expect(repo.get(LID)).toEqual({
        ...empty,
        id: newerId,
        name: 'Aisyah Rahman',
        email: 'a@pn.my',
        company: 'Co',
        // one tag per key, in the first-used spelling ('vip' was saved before 'VIP')
        tags: ['vip', 'Wholesale'],
        updatedAt: 300,
        updatedBy: 1,
      });
      expect(count('SELECT COUNT(*) AS n FROM customer_profiles WHERE chat_jid = ?', PN)).toBe(0);
      expect(count('SELECT COUNT(*) AS n FROM customer_tags WHERE chat_jid = ?', PN)).toBe(0);
      const meta = JSON.stringify(
        db.prepare("SELECT meta FROM audit_log WHERE action = 'chat.merge'").get(),
      );
      expect(meta).not.toContain('Aisyah Rahman');
    });

    it('carries the profile when the phone-number chat is re-keyed to a new LID chat', () => {
      seedChat(PN);
      seedMessages(PN, 1, 1000);
      const repo = new CustomerRepo(db);
      repo.save(PN, { ...empty, name: 'Aisyah Rahman' }, ['VIP'], 1, 300);
      const r = mergeChat(db, PN, LID, { now: 5000 })!;
      expect(r.rekeyed).toBe(true);
      expect(r.moved).toMatchObject({ profiles: 1, tags: 1 });
      expect(repo.get(LID)).toMatchObject({ name: 'Aisyah Rahman', tags: ['VIP'] });
      expect(repo.get(PN)).toBeNull();
    });
  });
});

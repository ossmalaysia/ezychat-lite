import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Report } from '@ezychat/shared';
import { openDb, type DB } from '../src/db/index.js';
import { REPORT_CACHE_MS, cachedReport, computeReport } from '../src/reports/report.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';

const TZ = 'Asia/Kuala_Lumpur';
/** Local time in Kuala Lumpur (UTC+8) on 2026-10-dd. Oct 16 is a Friday, Oct 21 a Wednesday. */
const at = (day: number, time: string) =>
  Date.parse(`2026-10-${String(day).padStart(2, '0')}T${time}:00+08:00`);
const NOW = at(21, '12:00');

let db: DB;
let seq = 0;

beforeEach(() => {
  db = openDb(':memory:');
  const user = db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, kind, created_at)
     VALUES (?, ?, ?, 'x', 'agent', ?, 0)`,
  );
  user.run(1, 'ali', 'Ali', 'human');
  user.run(2, 'ai', 'Sales Agent', 'ai');
});
afterEach(() => db.close());

function chat(jid: string, status: 'open' | 'resolved' = 'open', type: 'dm' | 'group' = 'dm') {
  db.prepare(
    `INSERT INTO chats (jid, type, name, unread_count, status, updated_at) VALUES (?, ?, ?, 0, ?, 0)`,
  ).run(jid, type, jid, status);
}

function msg(
  jid: string,
  t: number,
  from: 'customer' | number | 'phone',
  opts: {
    storedAt?: number;
    status?: 'sent' | 'failed';
    type?: 'text' | 'system';
    scheduledTaskId?: number;
  } = {},
) {
  db.prepare(
    `INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, status, timestamp, created_at,
       scheduled_task_id)
     VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?, ?)`,
  ).run(
    `m${++seq}`,
    jid,
    from === 'customer' ? 0 : 1,
    typeof from === 'number' ? from : null,
    opts.type ?? 'text',
    opts.status ?? 'sent',
    t,
    opts.storedAt ?? t,
    opts.scheduledTaskId ?? null,
  );
}

/** A close of the chat (`resolved` event), by a teammate (1) or the AI (2). */
function closed(jid: string, t: number, by: 1 | 2 = 1) {
  db.prepare(
    `INSERT INTO chat_events (chat_jid, type, actor_id, payload, at) VALUES (?, 'resolved', ?, '{}', ?)`,
  ).run(jid, by, t);
}

function auditRow(action: string, chatJid: string, t: number, reason?: string) {
  db.prepare('INSERT INTO audit_log (user_id, action, ip, meta, at) VALUES (2, ?, NULL, ?, ?)').run(
    action,
    JSON.stringify({ chatJid, reason }),
    t,
  );
}

describe('AI completion rate', () => {
  it('counts closed AI chats with no hand-off and no reply from a person as completed', () => {
    // 1: the AI answers, a teammate only presses Close: completed.
    chat('c1@s.whatsapp.net', 'resolved');
    msg('c1@s.whatsapp.net', at(20, '10:00'), 'customer');
    msg('c1@s.whatsapp.net', at(20, '10:01'), 2);
    closed('c1@s.whatsapp.net', at(20, '11:00'));
    // 2: the AI closes it itself: completed.
    chat('c2@s.whatsapp.net', 'resolved');
    msg('c2@s.whatsapp.net', at(19, '10:00'), 'customer');
    msg('c2@s.whatsapp.net', at(19, '10:01'), 2);
    closed('c2@s.whatsapp.net', at(19, '10:30'), 2);
    // 3: a teammate wrote BEFORE the AI's first reply only: still completed.
    chat('c3@s.whatsapp.net', 'resolved');
    msg('c3@s.whatsapp.net', at(18, '09:00'), 1);
    msg('c3@s.whatsapp.net', at(18, '09:10'), 'customer');
    msg('c3@s.whatsapp.net', at(18, '09:11'), 2);
    closed('c3@s.whatsapp.net', at(18, '09:30'));
    // 4: the AI hands over, then Ali replies: a hand-off.
    chat('h@s.whatsapp.net', 'resolved');
    msg('h@s.whatsapp.net', at(18, '10:00'), 'customer');
    msg('h@s.whatsapp.net', at(18, '10:01'), 2);
    auditRow('ai.handoff', 'h@s.whatsapp.net', at(18, '10:02'), 'needs_action');
    msg('h@s.whatsapp.net', at(18, '10:30'), 1);
    closed('h@s.whatsapp.net', at(18, '11:00'));
    // 4b: the hand-off is recorded just before its own line, the AI's only message: still a hand-off.
    chat('hf@s.whatsapp.net', 'resolved');
    msg('hf@s.whatsapp.net', at(17, '11:00'), 'customer');
    auditRow('ai.handoff', 'hf@s.whatsapp.net', at(17, '11:01'), 'asked_for_human');
    msg('hf@s.whatsapp.net', at(17, '11:02'), 2);
    closed('hf@s.whatsapp.net', at(17, '12:00'));
    // 5: someone wrote from the phone after the AI: a person replied.
    chat('r@s.whatsapp.net', 'resolved');
    msg('r@s.whatsapp.net', at(17, '10:00'), 'customer');
    msg('r@s.whatsapp.net', at(17, '10:01'), 2);
    msg('r@s.whatsapp.net', at(17, '10:20'), 'phone');
    closed('r@s.whatsapp.net', at(17, '10:30'));
    // Not AI cases: a team-only chat, a chat with only a scheduled message, and a failed AI reply.
    chat('t@s.whatsapp.net', 'resolved');
    msg('t@s.whatsapp.net', at(17, '10:00'), 'customer');
    msg('t@s.whatsapp.net', at(17, '10:01'), 1);
    closed('t@s.whatsapp.net', at(17, '10:30'));
    chat('s@s.whatsapp.net', 'resolved');
    msg('s@s.whatsapp.net', at(17, '09:00'), 2, { scheduledTaskId: 7 });
    closed('s@s.whatsapp.net', at(17, '09:30'));
    chat('f@s.whatsapp.net', 'resolved');
    msg('f@s.whatsapp.net', at(17, '09:00'), 'customer');
    msg('f@s.whatsapp.net', at(17, '09:01'), 2, { status: 'failed' });
    closed('f@s.whatsapp.net', at(17, '09:30'));
    // Two cases in one chat: before the first close the AI was alone (previous period); after it, a teammate replied.
    chat('x@s.whatsapp.net', 'resolved');
    msg('x@s.whatsapp.net', at(10, '10:00'), 'customer');
    msg('x@s.whatsapp.net', at(10, '10:01'), 2);
    closed('x@s.whatsapp.net', at(10, '11:00'));
    msg('x@s.whatsapp.net', at(16, '10:00'), 'customer');
    msg('x@s.whatsapp.net', at(16, '10:01'), 2);
    msg('x@s.whatsapp.net', at(16, '10:05'), 1);
    closed('x@s.whatsapp.net', at(16, '11:00'));
    // Open with the AI now (not counted yet), and an open chat whose AI reply came before its last close (that
    // close, on the 16th, is itself a completed case; the chat is not open with the AI).
    chat('o@s.whatsapp.net');
    db.prepare('UPDATE chats SET assigned_to = 2 WHERE jid = ?').run('o@s.whatsapp.net');
    msg('o@s.whatsapp.net', at(21, '09:00'), 'customer');
    msg('o@s.whatsapp.net', at(21, '09:01'), 2);
    // Open, but handed over (no longer held by the AI): not "still open with the AI".
    chat('ho@s.whatsapp.net');
    msg('ho@s.whatsapp.net', at(21, '09:00'), 'customer');
    msg('ho@s.whatsapp.net', at(21, '09:01'), 2);
    auditRow('ai.handoff', 'ho@s.whatsapp.net', at(21, '09:02'), 'asked_for_human');
    chat('z@s.whatsapp.net');
    msg('z@s.whatsapp.net', at(16, '09:01'), 2);
    closed('z@s.whatsapp.net', at(16, '10:00'));
    msg('z@s.whatsapp.net', at(21, '09:00'), 'customer');
    // Groups never count.
    chat('g@g.us', 'resolved', 'group');
    msg('g@g.us', at(20, '10:01'), 2);
    closed('g@g.us', at(20, '11:00'));

    const r = computeReport(db, { days: 7, timeZone: TZ, now: NOW });

    expect(Report.parse(r)).toEqual(r);
    expect(r.totals).toMatchObject({
      aiClosed: 8,
      aiCompleted: 4,
      aiClosedAfterHandoff: 2,
      aiClosedAfterReply: 2,
    });
    expect(r.previous).toMatchObject({ aiClosed: 1, aiCompleted: 1 });
    expect(r.aiOpen).toBe(1);
  });

  it('an older report without the new numbers still reads, as zero', () => {
    const r = computeReport(db, { days: 7, timeZone: TZ, now: NOW });
    const { aiClosed: _a, aiCompleted: _b, ...old } = r.totals;
    const { aiOpen: _o, ...rest } = r;
    const parsed = Report.parse({ ...rest, totals: old });
    expect(parsed.totals.aiClosed).toBe(0);
    expect(parsed.aiOpen).toBe(0);
  });
});

describe('computeReport', () => {
  it('counts new customers, missed ones, busy days and times, hand-offs and the team', () => {
    const LINKED = at(5, '09:00');
    // H wrote before WhatsApp was linked (history import): an existing customer, never new.
    chat('h@s.whatsapp.net');
    msg('h@s.whatsapp.net', at(3, '10:00'), 'customer', { storedAt: LINKED });
    msg('h@s.whatsapp.net', at(16, '15:00'), 'customer');
    // P: a new customer in the previous 7 days, answered in 5 minutes.
    chat('p@s.whatsapp.net', 'resolved');
    msg('p@s.whatsapp.net', at(10, '10:00'), 'customer');
    msg('p@s.whatsapp.net', at(10, '10:05'), 1);
    auditRow('ai.handoff', 'p@s.whatsapp.net', at(10, '10:01'), 'needs_action');
    // A: new on Friday 16th, the AI answers after 2 minutes, then hands over; nobody since.
    chat('a@s.whatsapp.net');
    msg('a@s.whatsapp.net', at(16, '10:00'), 'customer');
    msg('a@s.whatsapp.net', at(16, '10:02'), 2);
    auditRow('ai.handoff', 'a@s.whatsapp.net', at(16, '10:03'), 'missing_facts');
    // B: new on Saturday, handed over, Ali answers after 2 hours: missed, but no longer waiting.
    chat('b@s.whatsapp.net');
    msg('b@s.whatsapp.net', at(17, '09:00'), 'customer');
    auditRow('ai.handoff', 'b@s.whatsapp.net', at(17, '09:30'), 'business_rule');
    msg('b@s.whatsapp.net', at(17, '11:00'), 1);
    msg('b@s.whatsapp.net', at(17, '11:01'), 1, { status: 'failed' }); // never reached the customer
    // C: new 30 minutes ago, no reply yet: not missed yet. D: no reply for 4 hours: missed.
    chat('c@s.whatsapp.net');
    msg('c@s.whatsapp.net', at(21, '11:30'), 'customer');
    chat('d@s.whatsapp.net');
    msg('d@s.whatsapp.net', at(21, '08:00'), 'customer');
    // E: we wrote first (from the phone), so not a new customer; the AI later closes it.
    chat('e@s.whatsapp.net');
    msg('e@s.whatsapp.net', at(18, '10:00'), 'phone');
    msg('e@s.whatsapp.net', at(18, '10:10'), 'customer');
    msg('e@s.whatsapp.net', at(18, '10:11'), 'customer', { type: 'system' });
    auditRow('ai.resolve', 'e@s.whatsapp.net', at(18, '10:20'));
    // Groups are not customers.
    chat('g@g.us', 'open', 'group');
    msg('g@g.us', at(16, '10:00'), 'customer');

    const r = computeReport(db, { days: 7, timeZone: TZ, now: NOW });

    expect(Report.parse(r)).toEqual(r);
    expect(r.firstDate).toBe('2026-10-03');
    expect(r.linkedDate).toBe('2026-10-05');
    expect(r.totals).toEqual({
      newCustomers: 4,
      messagesIn: 6,
      messagesOut: 3,
      activeChats: 6,
      medianFirstReplyMinutes: 2,
      missedLeads: 2,
      aiAnswered: 1,
      aiResolved: 1,
      aiHandoffs: 2,
      aiClosed: 0,
      aiCompleted: 0,
      aiClosedAfterHandoff: 0,
      aiClosedAfterReply: 0,
    });
    expect(r.previous).toMatchObject({
      newCustomers: 1,
      messagesIn: 1,
      messagesOut: 1,
      missedLeads: 0,
      aiHandoffs: 1,
      medianFirstReplyMinutes: 5,
    });
    expect(r.waitingAfterHandoff).toEqual({ count: 1, oldestAt: at(16, '10:03') });

    expect(r.daily.map((d) => d.date)).toEqual([
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(r.daily[1]).toEqual({
      date: '2026-10-16',
      inbound: 2,
      outbound: 1,
      newCustomers: 1,
      activeChats: 2,
    });
    expect(r.daily[6]).toMatchObject({ inbound: 2, newCustomers: 2 });
    // Seven days hold each weekday once: Friday the 16th is the busiest, Thursday the 15th is empty.
    expect(r.weekdays[3]).toEqual({ weekday: 3, avgInbound: 0, avgChats: 0 });
    expect(r.weekdays[4]).toEqual({ weekday: 4, avgInbound: 2, avgChats: 2 });
    expect(r.weekdays[5]).toEqual({ weekday: 5, avgInbound: 1, avgChats: 1 });
    expect(r.hours[4]![10]).toBe(1);
    expect(r.hours[4]![15]).toBe(1);
    expect(r.hours.flat().reduce((a, b) => a + b)).toBe(6);

    expect(r.handoffReasons).toEqual([
      { reason: 'business_rule', count: 1 },
      { reason: 'missing_facts', count: 1 },
    ]);
    expect(r.team).toEqual(
      expect.arrayContaining([
        { userId: 2, name: 'Sales Agent', kind: 'ai', chats: 1, replies: 1, medianReplyMinutes: 2 },
        { userId: 1, name: 'Ali', kind: 'human', chats: 1, replies: 1, medianReplyMinutes: 120 },
        { userId: null, name: '', kind: 'phone', chats: 1, replies: 1, medianReplyMinutes: null },
      ]),
    );
  });

  it('starts the days at the first message and has no previous period on a new install', () => {
    chat('a@s.whatsapp.net');
    msg('a@s.whatsapp.net', at(19, '10:00'), 'customer');
    msg('a@s.whatsapp.net', at(20, '10:00'), 'customer');
    const r = computeReport(db, { days: 30, timeZone: TZ, now: NOW });
    expect(r.daily.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    // Averages divide by the days shown (Mon 19th, Tue 20th), not by the 30 days asked for.
    expect(r.weekdays[0]!.avgInbound).toBe(1);
    expect(r.previous).toBeNull();
    expect(r.totals.newCustomers).toBe(1);
  });

  it('is empty before any message', () => {
    const r = computeReport(db, { days: 7, timeZone: TZ, now: NOW });
    expect(r).toMatchObject({
      firstDate: null,
      linkedDate: null,
      previous: null,
      daily: [],
      handoffReasons: [],
      team: [],
      waitingAfterHandoff: { count: 0, oldestAt: null },
    });
    expect(r.totals.messagesIn).toBe(0);
    expect(r.weekdays.every((w) => w.avgInbound === 0)).toBe(true);
  });

  it('keeps to the given inboxes', () => {
    chat('a@s.whatsapp.net');
    msg('a@s.whatsapp.net', at(20, '10:00'), 'customer');
    auditRow('ai.handoff', 'a@s.whatsapp.net', at(20, '10:01'), 'sensitive');
    db.prepare(
      `INSERT INTO chats (jid, type, name, unread_count, status, updated_at, inbox_id)
       VALUES ('b@s.whatsapp.net#2', 'dm', 'B', 0, 'open', 0, 2)`,
    ).run();
    msg('b@s.whatsapp.net#2', at(20, '11:00'), 'customer');
    auditRow('ai.handoff', 'b@s.whatsapp.net#2', at(20, '11:01'), 'sensitive');
    auditRow('ai.handoff', 'not json', at(20, '11:02'));
    db.prepare("UPDATE audit_log SET meta = 'oops' WHERE meta LIKE '%not json%'").run();

    const r = computeReport(db, { days: 7, timeZone: TZ, now: NOW, inboxIds: [1] });
    expect(r.totals).toMatchObject({ messagesIn: 1, newCustomers: 1, aiHandoffs: 1 });
    expect(r.waitingAfterHandoff.count).toBe(1);
    const all = computeReport(db, { days: 7, timeZone: TZ, now: NOW });
    expect(all.totals).toMatchObject({ messagesIn: 2, newCustomers: 2, aiHandoffs: 2 });
    expect(all.waitingAfterHandoff.count).toBe(2);
  });
});

describe('cachedReport', () => {
  it('reuses a report for a minute per period and scope, then counts again', () => {
    chat('a@s.whatsapp.net');
    msg('a@s.whatsapp.net', at(20, '10:00'), 'customer');
    const opts = { days: 7 as const, timeZone: TZ, now: NOW };
    const first = cachedReport(db, opts);
    expect(first.totals.messagesIn).toBe(1);
    msg('a@s.whatsapp.net', at(20, '11:00'), 'customer');
    expect(cachedReport(db, { ...opts, now: NOW + REPORT_CACHE_MS - 1 })).toBe(first);
    // Another period or scope is counted on its own.
    expect(cachedReport(db, { ...opts, days: 30 }).totals.messagesIn).toBe(2);
    expect(cachedReport(db, { ...opts, inboxIds: [1] }).totals.messagesIn).toBe(2);
    // After a minute (or with a clock that went back) it counts again.
    expect(cachedReport(db, { ...opts, now: NOW + REPORT_CACHE_MS }).totals.messagesIn).toBe(2);
    expect(cachedReport(db, { ...opts, now: NOW - 1 }).totals.messagesIn).toBe(2);
    // The same inboxes in another order share one entry.
    const two = cachedReport(db, { ...opts, inboxIds: [2, 1] });
    expect(cachedReport(db, { ...opts, inboxIds: [1, 2] })).toBe(two);
  });
});

describe('GET /api/reports', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });
  afterEach(async () => {
    await t.close();
  });

  it('answers admins only, for 7, 30 or 90 days', async () => {
    const agent = await createUserAndLogin(t);
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const get = (url: string, cookie?: string) =>
      t.app.inject({ method: 'GET', url, headers: cookie ? authHeaders(cookie) : {} });

    expect((await get('/api/reports')).statusCode).toBe(401);
    expect((await get('/api/reports', agent.cookie)).statusCode).toBe(403);
    expect((await get('/api/reports?days=5', admin.cookie)).statusCode).toBe(400);
    const res = await get('/api/reports?days=90', admin.cookie);
    expect(res.statusCode).toBe(200);
    const body = Report.parse(res.json());
    expect(body).toMatchObject({ days: 90, timeZone: 'Asia/Kuala_Lumpur', daily: [] });
    expect(Report.parse((await get('/api/reports', admin.cookie)).json()).days).toBe(30);
  });

  it('counts every inbox together or one inbox, and refuses an unknown inbox', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    const get = (url: string) =>
      t.app.inject({ method: 'GET', url, headers: authHeaders(admin.cookie) });
    const db = t.ctx.db;
    db.prepare(
      "INSERT INTO inboxes (id, name, tone, auth_dir, created_at, removed_at) VALUES (2, 'Catering', 'info', 'x', 0, NULL)",
    ).run();
    const now = Date.now();
    const add = (jid: string, inboxId: number, n: number) => {
      db.prepare(
        `INSERT INTO chats (jid, type, name, unread_count, status, updated_at, inbox_id)
         VALUES (?, 'dm', ?, 0, 'open', 0, ?)`,
      ).run(jid, jid, inboxId);
      for (let i = 0; i < n; i++)
        db.prepare(
          `INSERT INTO messages (id, chat_jid, from_me, type, body, status, timestamp, created_at)
           VALUES (?, ?, 0, 'text', 'x', 'sent', ?, ?)`,
        ).run(`${jid}-${i}`, jid, now - 3_600_000 - i, now - 86_400_000 * 10);
    };
    add('a@s.whatsapp.net', 1, 2);
    add('b@s.whatsapp.net#2', 2, 3);

    const all = Report.parse((await get('/api/reports?days=7')).json());
    expect([all.inboxId, all.totals.messagesIn]).toEqual([null, 5]);
    const one = Report.parse((await get('/api/reports?days=7&inbox=1')).json());
    expect([one.inboxId, one.totals.messagesIn]).toEqual([1, 2]);
    const two = Report.parse((await get('/api/reports?days=7&inbox=2')).json());
    expect([two.inboxId, two.totals.messagesIn]).toEqual([2, 3]);
    // A removed inbox keeps its report (its chats stay for admins).
    db.prepare('UPDATE inboxes SET removed_at = 1 WHERE id = 2').run();
    expect(Report.parse((await get('/api/reports?days=30&inbox=2')).json()).totals.messagesIn).toBe(
      3,
    );

    const unknown = await get('/api/reports?inbox=9');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('not_found');
    expect((await get('/api/reports?inbox=0')).statusCode).toBe(400);
    expect((await get('/api/reports?inbox=x')).statusCode).toBe(400);
  });
});

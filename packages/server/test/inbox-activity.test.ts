import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db/index.js';
import { computeInboxActivity } from '../src/chats/activity.js';

const TZ = 'Asia/Kuala_Lumpur';
/** Local time in Kuala Lumpur (UTC+8) on 2026-10-dd. Oct 6 is a Tuesday, Oct 7 a Wednesday. */
const at = (day: number, time: string) => Date.parse(`2026-10-0${day}T${time}:00+08:00`);

let db: DB;
let seq = 0;

beforeEach(() => {
  db = openDb(':memory:');
  const user = db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
     VALUES (?, ?, ?, 'x', 'agent', 0)`,
  );
  user.run(1, 'ali', 'Ali');
  user.run(2, 'ai', 'AI Sales Agent');
  const chat = db.prepare(
    `INSERT INTO chats (jid, type, name, unread_count, status, updated_at)
     VALUES (?, ?, ?, 0, 'open', 0)`,
  );
  chat.run('a@s.whatsapp.net', 'dm', 'A');
  chat.run('b@s.whatsapp.net', 'dm', 'B');
  chat.run('g@g.us', 'group', 'G');
});
afterEach(() => db.close());

function msg(
  chat: string,
  t: number,
  from: 'customer' | number | 'phone',
  status: 'sent' | 'failed' = 'sent',
  id = `m${++seq}`,
) {
  db.prepare(
    `INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, status, timestamp, created_at)
     VALUES (?, ?, ?, ?, 'text', 'x', ?, ?, ?)`,
  ).run(
    id,
    chat,
    from === 'customer' ? 0 : 1,
    typeof from === 'number' ? from : null,
    status,
    t,
    t,
  );
}

it('counts peak hours, waits and responders in the business time zone', () => {
  const A = 'a@s.whatsapp.net';
  const B = 'b@s.whatsapp.net';
  // A: the wait opened before the period, so Ali's reply is not a timed first reply; 09:00 is
  // under 12 h after 23:00, so it is not a new conversation either.
  msg(A, at(5, '23:00'), 'customer');
  msg(A, at(6, '09:00'), 'customer');
  msg(A, at(6, '09:10'), 1);
  msg(A, at(6, '21:00'), 'customer');
  msg(A, at(6, '21:01'), 'customer'); // same wait as 21:00
  msg(A, at(6, '21:05'), 2); // AI answers after 5 min
  // B: new conversation at 10:00, answered from the phone after 30 min; 11:00 is still waiting
  // (the failed send never reached the customer).
  msg(B, at(7, '10:00'), 'customer');
  msg(B, at(7, '10:30'), 'phone');
  msg(B, at(7, '11:00'), 'customer');
  msg(B, at(7, '11:05'), 1, 'failed');
  msg('g@g.us', at(7, '10:00'), 'customer'); // groups are left out

  const a = computeInboxActivity(db, { days: 2, timeZone: TZ, now: at(7, '12:00') });

  expect(a.from).toBe(at(6, '00:00'));
  expect(a.byHour[9]).toEqual({
    hour: 9,
    customerMessages: 1,
    newConversations: 0,
    teamReplies: 1,
  });
  expect(a.byHour[10]).toEqual({
    hour: 10,
    customerMessages: 1,
    newConversations: 1,
    teamReplies: 1,
  });
  expect(a.byHour[11]).toEqual({
    hour: 11,
    customerMessages: 1,
    newConversations: 0,
    teamReplies: 0,
  });
  expect(a.byHour[21]).toEqual({
    hour: 21,
    customerMessages: 2,
    newConversations: 0,
    teamReplies: 1,
  });
  expect(a.byWeekday.find((d) => d.weekday === 'Tue')!.customerMessages).toBe(3);
  expect(a.byWeekday.find((d) => d.weekday === 'Wed')!.customerMessages).toBe(2);
  expect(a.newConversationsHeatmap.Wed[10]).toBe(1);
  expect(
    Object.values(a.newConversationsHeatmap)
      .flat()
      .reduce((x, y) => x + y),
  ).toBe(1);

  expect(a.firstReply).toMatchObject({ answered: 2, unanswered: 1, median: 5, p90: 30 });
  expect(a.firstReply.byHour[21]).toEqual({ hour: 21, answered: 1, unanswered: 0, median: 5 });
  expect(a.firstReply.byHour[11]).toEqual({ hour: 11, answered: 0, unanswered: 1, median: null });

  const by = (id: number | null) => a.responders.find((r) => r.userId === id)!;
  expect(by(1)).toMatchObject({ messages: 1, chats: 1, firstReplies: 0 });
  expect(by(1).messagesByHour[9]).toBe(1);
  expect(by(2)).toMatchObject({ messages: 1, firstReplies: 1, firstReplyMinutes: { median: 5 } });
  expect(by(null)).toMatchObject({
    messages: 1,
    firstReplies: 1,
    firstReplyMinutes: { median: 30 },
  });
});

it('keeps a wait opened long before the period, and same-second replies in stored order', () => {
  const A = 'a@s.whatsapp.net';
  const B = 'b@s.whatsapp.net';
  // A: unanswered since 26 h before the period, so the answered follow-up is not a new wait.
  msg(A, at(5, '08:00'), 'customer');
  msg(A, at(6, '10:00'), 'customer');
  msg(A, at(6, '10:05'), 1);
  // B: the phone replies in the same second; its WhatsApp id sorts before the customer's.
  msg(B, at(6, '11:00'), 'customer', 'sent', 'ZZZ');
  msg(B, at(6, '11:00'), 'phone', 'sent', 'AAA');

  const a = computeInboxActivity(db, { days: 2, timeZone: TZ, now: at(7, '12:00') });

  expect(a.firstReply).toMatchObject({ answered: 1, unanswered: 0, median: 0 });
  expect(a.firstReply.byHour[10]).toEqual({ hour: 10, answered: 0, unanswered: 0, median: null });
  // 10:00 still starts a new conversation: the chat was silent for 26 h.
  expect(a.byHour[10]!.newConversations).toBe(1);
});

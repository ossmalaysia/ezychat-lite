import { afterEach, describe, expect, it } from 'vitest';
import { collectTakeovers, questionsAnsweredByAi } from '../src/ai/dream/collect.js';
import type { TestApp } from './helpers.js';
import { DAY, MIN, dreamApp } from './dream-helpers.js';

const open: TestApp[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const T0 = 10 * DAY;

async function setup() {
  const s = await dreamApp();
  open.push(s.t);
  return { ...s, window: { agentId: s.agent.id, from: T0 - DAY, to: T0 + DAY } };
}

const A = '60111111111@s.whatsapp.net';
const B = '60122222222@s.whatsapp.net';

describe('collectTakeovers', () => {
  it('finds a hand-off followed by a teammate reply', async () => {
    const s = await setup();
    s.chat(A, 'Ahmad Lee');
    s.msg(A, T0, 'customer', 'Are you open on Saturday?');
    s.msg(A, T0 + MIN, 'ai', 'Let me check with the team.');
    s.handoff(A, T0 + 2 * MIN);
    s.msg(A, T0 + 5 * MIN, 'team', 'Yes, Saturday 9 am to 1 pm.');
    const [chat, ...rest] = collectTakeovers(s.t.ctx, s.window);
    expect(rest).toEqual([]);
    expect(chat).toMatchObject({ chatJid: A, kind: 'handoff', handoffReason: 'missing_facts' });
    expect(chat!.messages.map((m) => [m.localId, m.role, m.text])).toEqual([
      [1, 'customer', 'Are you open on Saturday?'],
      [2, 'ai', 'Let me check with the team.'],
      [3, 'team', 'Yes, Saturday 9 am to 1 pm.'],
    ]);
    expect(chat!.messages[2]!.messageId).toBeTypeOf('string');
  });

  it('finds a teammate reply over the AI and counts the linked phone after a hand-off', async () => {
    const s = await setup();
    s.chat(A, 'One');
    s.msg(A, T0, 'customer', 'Price of the basic plan?');
    s.msg(A, T0 + MIN, 'ai', 'It is RM 50.');
    s.replyOverAi(A, T0 + 2 * MIN);
    s.msg(A, T0 + 2 * MIN, 'team', 'Sorry, it is RM 60 now.');
    s.chat(B, 'Two');
    s.msg(B, T0, 'customer', 'Do you deliver to Johor?');
    s.handoff(B, T0 + MIN);
    s.msg(B, T0 + 3 * MIN, 'phone', 'Yes, RM 15 to Johor.');
    const found = collectTakeovers(s.t.ctx, s.window);
    expect(found.map((c) => [c.chatJid, c.kind])).toEqual(
      expect.arrayContaining([
        [A, 'reply_over_ai'],
        [B, 'handoff'],
      ]),
    );
    expect(found.find((c) => c.chatJid === A)!.handoffReason).toBeNull();
  });

  it('skips a take-over whose only team reply was forwarded', async () => {
    const s = await setup();
    s.chat(A, 'One');
    s.msg(A, T0, 'customer', 'Send me the price list');
    s.handoff(A, T0 + MIN);
    s.msg(A, T0 + 2 * MIN, 'team', 'Basic RM 50, Pro RM 90', { forwarded: true });
    expect(collectTakeovers(s.t.ctx, s.window)).toEqual([]);
  });

  it('leaves out forwarded, deleted and captionless customer messages', async () => {
    const s = await setup();
    s.chat(A, 'One');
    s.msg(A, T0, 'customer', 'Look at this offer', { forwarded: true });
    s.msg(A, T0 + MIN, 'customer', 'old text', { deleted: true });
    s.msg(A, T0 + 2 * MIN, 'customer', null, { type: 'image' });
    s.msg(A, T0 + 3 * MIN, 'customer', 'Can you match it?');
    s.handoff(A, T0 + 4 * MIN);
    s.msg(A, T0 + 5 * MIN, 'team', 'We can give 10 % off.');
    const [chat] = collectTakeovers(s.t.ctx, s.window);
    expect(chat!.messages.map((m) => m.text)).toEqual([
      'Can you match it?',
      'We can give 10 % off.',
    ]);
  });

  it('leaves out a message Safety flagged or is still checking', async () => {
    const s = await setup();
    s.chat(A, 'One');
    const flagged = s.msg(A, T0, 'customer', 'Click this link to claim');
    const checking = s.msg(A, T0 + MIN, 'customer', 'Open the attached file');
    s.msg(A, T0 + 2 * MIN, 'customer', 'Is my order sent?');
    s.handoff(A, T0 + 3 * MIN);
    s.msg(A, T0 + 4 * MIN, 'team', 'Yes, it left today.');
    const safety = s.t.ctx.db.prepare(
      `INSERT INTO safety_items (message_id, chat_jid, inbox_id, rules, score, rule_level, critical, ai_level, level,
         status, existing_customer, has_file, created_at, updated_at)
       VALUES (?, ?, 1, '[]', 50, 'warning', 0, ?, ?, 'open', 1, 0, 1, 1)`,
    );
    safety.run(flagged, A, 'high', 'high');
    safety.run(checking, A, null, 'warning');
    const [chat] = collectTakeovers(s.t.ctx, s.window);
    expect(chat!.messages.map((m) => m.text)).toEqual(['Is my order sent?', 'Yes, it left today.']);
  });

  it('cleans names, numbers and emails before the lesson call', async () => {
    const s = await setup();
    s.chat(A, 'Ahmad Lee');
    s.msg(A, T0, 'customer', 'Hi, this is Ahmad, email ahmad@mail.com');
    s.handoff(A, T0 + MIN);
    s.msg(A, T0 + 2 * MIN, 'team', 'Hi Ahmad, call us at 012-345 6789 or sales@shop.my');
    const text = collectTakeovers(s.t.ctx, s.window)[0]!
      .messages.map((m) => m.text)
      .join(' ');
    expect(text).not.toMatch(/Ahmad|@|345/);
  });

  it('never returns groups, other inboxes or chats outside the window', async () => {
    const s = await setup();
    s.chat('1203@g.us', 'Group', 'group');
    s.msg('1203@g.us', T0, 'customer', 'Q');
    s.handoff('1203@g.us', T0 + MIN);
    s.msg('1203@g.us', T0 + 2 * MIN, 'team', 'A');
    s.chat(A, 'Old');
    s.msg(A, T0 - 3 * DAY, 'customer', 'Q');
    s.handoff(A, T0 - 3 * DAY + MIN);
    s.msg(A, T0 - 3 * DAY + 2 * MIN, 'team', 'A');
    expect(collectTakeovers(s.t.ctx, s.window)).toEqual([]);
  });

  it('keeps the 30 most recent take-overs', async () => {
    const s = await setup();
    for (let i = 0; i < 31; i++) {
      const jid = `6013${String(i).padStart(7, '0')}@s.whatsapp.net`;
      s.chat(jid, `Chat ${i}`);
      s.msg(jid, T0 + i * MIN, 'customer', 'Q');
      s.handoff(jid, T0 + i * MIN + 1);
      s.msg(jid, T0 + i * MIN + 2, 'team', 'A');
    }
    const found = collectTakeovers(s.t.ctx, s.window);
    expect(found).toHaveLength(30);
    expect(found.some((c) => c.chatJid === '60130000000@s.whatsapp.net')).toBe(false);
  });
});

describe('questionsAnsweredByAi', () => {
  it('returns customer questions the AI answered without a hand-off', async () => {
    const s = await setup();
    s.chat(A, 'One');
    s.msg(A, T0, 'customer', 'Where are you located?');
    s.msg(A, T0 + MIN, 'ai', 'We are in George Town.');
    s.chat(B, 'Two');
    s.msg(B, T0, 'customer', 'I want a refund');
    s.handoff(B, T0 + MIN);
    expect(questionsAnsweredByAi(s.t.ctx, s.window)).toEqual(['Where are you located?']);
  });
});

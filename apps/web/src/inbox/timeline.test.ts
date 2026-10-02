import { describe, expect, it } from 'vitest';
import type { ChatEvent, Message, Note } from '@wa-team-inbox/shared';
import { buildTimeline } from './timeline';

function msg(id: string, timestamp: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    chatJid: '60123@s.whatsapp.net',
    senderJid: null,
    senderName: null,
    fromMe: false,
    sentByUserId: null,
    type: 'text',
    body: id,
    mediaUrl: null,
    mediaMime: null,
    mediaName: null,
    mediaStatus: 'none',
    quotedId: null,
    status: 'delivered',
    error: null,
    timestamp,
    clientId: null,
    ...extra,
  };
}

// Local-time dates so day boundaries match the user's timezone.
const day1 = new Date(2026, 9, 1, 9, 0).getTime();
const day1Late = new Date(2026, 9, 1, 23, 30).getTime();
const day2 = new Date(2026, 9, 2, 8, 15).getTime();
const day2Later = new Date(2026, 9, 2, 10, 0).getTime();

describe('buildTimeline', () => {
  it('merges messages, events and notes in time order with day separators across two days', () => {
    const messages = [msg('m3', day2Later), msg('m1', day1)];
    const events: ChatEvent[] = [
      { id: 1, chatJid: 'x', type: 'assigned', actorId: 1, payload: { to: 2 }, at: day1Late },
    ];
    const notes: Note[] = [{ id: 7, chatJid: 'x', userId: 1, body: 'call back', createdAt: day2 }];

    const items = buildTimeline(messages, events, notes);
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'event', 'day', 'note', 'message']);

    const days = items.filter((i) => i.kind === 'day');
    expect(days).toHaveLength(2);
    const [d1, d2] = days;
    expect(d1 && d1.kind === 'day' && new Date(d1.date).getDate()).toBe(1);
    expect(d2 && d2.kind === 'day' && new Date(d2.date).getDate()).toBe(2);

    const m = items[1];
    expect(m?.kind === 'message' && m.message.id).toBe('m1');
    const last = items[5];
    expect(last?.kind === 'message' && last.message.id).toBe('m3');
  });

  it('returns an empty list for no input and gives every item a unique key', () => {
    expect(buildTimeline([], [], [])).toEqual([]);
    const items = buildTimeline([msg('a', day1), msg('b', day1 + 1000)], [], []);
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'message']);
  });

  it('orders same-timestamp messages by id for stability', () => {
    const items = buildTimeline([msg('b', day1), msg('a', day1)], [], []);
    const ids = items.flatMap((i) => (i.kind === 'message' ? [i.message.id] : []));
    expect(ids).toEqual(['a', 'b']);
  });
});

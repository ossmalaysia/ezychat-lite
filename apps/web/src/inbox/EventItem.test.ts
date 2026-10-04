import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@wa-team-inbox/shared';
import { describeEvent } from './EventItem';
import type { Directory } from './useDirectory';

const names: Record<number, string> = { 1: 'Jazz', 2: 'Jee Fong' };
const dir = {
  nameOf: (id: number | null | undefined, opts?: { youLabel?: boolean }) =>
    id == null ? null : opts?.youLabel && id === 1 ? 'You' : (names[id] ?? null),
} as Directory;

const event = (
  type: ChatEvent['type'],
  actorId: number | null,
  payload: Record<string, unknown> = {},
): ChatEvent => ({
  id: 1,
  chatJid: '60123@s.whatsapp.net',
  type,
  actorId,
  payload,
  at: 0,
});

describe('describeEvent', () => {
  it('explains an owner claimed by replying', () => {
    expect(
      describeEvent(event('assigned', 2, { assignedTo: 2, previous: null, reason: 'reply' }), dir),
    ).toBe('Jee Fong took this chat by replying');
  });

  it('explains an owner released by resolving', () => {
    expect(describeEvent(event('unassigned', 1, { previous: 1, reason: 'resolved' }), dir)).toBe(
      'Chat returned to the team',
    );
  });

  it('keeps the wording for manual assignment changes', () => {
    expect(describeEvent(event('assigned', 1, { assignedTo: 1 }), dir)).toBe('You took this chat');
    expect(describeEvent(event('assigned', 1, { assignedTo: 2 }), dir)).toBe(
      'You assigned this chat to Jee Fong',
    );
    expect(describeEvent(event('unassigned', 2, { previous: 1 }), dir)).toBe(
      'Jee Fong unassigned this chat',
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { TakeoverChat } from './collect.js';
import {
  acceptLessons,
  acceptProposals,
  lessonInput,
  mergeInput,
  type DreamLesson,
  type DreamSetup,
} from './prompts.js';

const chat: TakeoverChat = {
  chatJid: '601@s.whatsapp.net',
  kind: 'handoff',
  handoffReason: 'missing_facts',
  messages: [
    { localId: 1, messageId: 'WA-1', role: 'customer', at: 1, text: 'Open on Saturday?' },
    { localId: 2, messageId: 'WA-2', role: 'ai', at: 2, text: 'Let me check.' },
    {
      localId: 3,
      messageId: 'WA-3',
      role: 'team',
      at: 3,
      text: 'Yes, 9 am to 1 pm, RM 15 delivery.',
    },
  ],
};

describe('lessonInput', () => {
  it('shows the model local ids and roles only, never stored message ids or the chat key', () => {
    const input = lessonInput(chat);
    expect(input).toContain('Open on Saturday?');
    expect(input).toContain('missing_facts');
    expect(input).not.toMatch(/WA-|601@/);
  });
});

describe('acceptLessons', () => {
  const lesson = (over: Partial<DreamLesson>): DreamLesson => ({
    kind: 'fact',
    text: 'Open on Saturday 9 am to 1 pm.',
    teamMessageIds: [3],
    ...over,
  });

  it('keeps at most 3 lessons that cite a team message of the chat', () => {
    const out = acceptLessons({ lessons: [lesson({}), lesson({}), lesson({}), lesson({})] }, chat);
    expect(out).toHaveLength(3);
  });

  it('drops a lesson that cites no team message', () => {
    expect(acceptLessons({ lessons: [lesson({ teamMessageIds: [] })] }, chat)).toEqual([]);
    expect(acceptLessons({ lessons: [lesson({ teamMessageIds: [1] })] }, chat)).toEqual([]);
  });

  it('drops a lesson with a number the cited team reply does not have', () => {
    expect(acceptLessons({ lessons: [lesson({ text: 'Delivery is RM 25.' })] }, chat)).toEqual([]);
    expect(acceptLessons({ lessons: [lesson({ text: 'Delivery is RM 15.' })] }, chat)).toHaveLength(
      1,
    );
  });

  it('drops a lesson that holds an email or a phone number', () => {
    expect(
      acceptLessons({ lessons: [lesson({ text: 'Call 0123456789 at 9 am.' })] }, chat),
    ).toEqual([]);
    expect(acceptLessons({ lessons: [lesson({ text: 'Email a@b.co at 9 am.' })] }, chat)).toEqual(
      [],
    );
  });
});

describe('mergeInput / acceptProposals', () => {
  const setup: DreamSetup = {
    instructions: 'Be kind.',
    handoffRules: 'Hand over refunds.',
    items: [
      { id: 7, name: 'Opening hours', text: 'Closed on weekends.', internal: false },
      { id: 8, name: 'Cost prices', text: 'Our cost is RM 3.', internal: true },
    ],
  };
  const lessons: DreamLesson[] = [
    { kind: 'fact', text: 'Open Saturday 9 to 1.', teamMessageIds: [3] },
  ];

  it('never puts Internal items in the merge input', () => {
    const input = mergeInput(lessons, setup);
    expect(input).toContain('Closed on weekends.');
    expect(input).not.toContain('Our cost is RM 3.');
  });

  it('keeps at most 5 changes, each naming a lesson and a real text item', () => {
    const p = {
      target: 'context_text' as const,
      itemId: 7,
      name: null,
      after: 'Saturday 9 to 1.',
      summary: 's',
      lessonIds: [1],
    };
    const many = Array.from({ length: 6 }, (_, i) => ({ ...p, after: `Saturday ${i}` }));
    expect(acceptProposals({ changes: many }, lessons, setup)).toHaveLength(5);
    expect(acceptProposals({ changes: [{ ...p, lessonIds: [] }] }, lessons, setup)).toEqual([]);
    expect(acceptProposals({ changes: [{ ...p, itemId: 8 }] }, lessons, setup)).toEqual([]);
    expect(acceptProposals({ changes: [{ ...p, itemId: 99 }] }, lessons, setup)).toEqual([]);
    expect(
      acceptProposals({ changes: [{ ...p, after: 'Closed on weekends.' }] }, lessons, setup),
    ).toEqual([]);
  });

  it('accepts a new item with a name, and hand-off and instruction edits', () => {
    const out = acceptProposals(
      {
        changes: [
          {
            target: 'context_text',
            itemId: null,
            name: 'Delivery',
            after: 'Johor RM 15.',
            summary: 'a',
            lessonIds: [1],
          },
          {
            target: 'handoff_rules',
            itemId: null,
            name: null,
            after: 'Hand over refunds and complaints.',
            summary: 'b',
            lessonIds: [1],
          },
          {
            target: 'context_text',
            itemId: null,
            name: null,
            after: 'No name.',
            summary: 'c',
            lessonIds: [1],
          },
        ],
      },
      lessons,
      setup,
    );
    expect(out.map((c) => c.summary)).toEqual(['a', 'b']);
  });
});

import { describe, expect, it } from 'vitest';
import { AskEzyAnswer, AskEzyBlock, AskEzyEvent, AskEzyRequest } from './ask-ezy';

const hours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

describe('Ask Ezy contract', () => {
  it('fills the defaults of a first question and refuses an empty or too long one', () => {
    expect(AskEzyRequest.parse({ question: ' How is my week? ' })).toEqual({
      question: 'How is my week?',
      history: [],
      chatJid: null,
    });
    expect(AskEzyRequest.safeParse({ question: '   ' }).success).toBe(false);
    expect(AskEzyRequest.safeParse({ question: 'x'.repeat(2001) }).success).toBe(false);
    expect(AskEzyRequest.safeParse({ question: 'hi', extra: 1 }).success).toBe(false);
    const history = Array.from({ length: 13 }, () => ({ role: 'user', text: 'q' }));
    expect(AskEzyRequest.safeParse({ question: 'hi', history }).success).toBe(false);
  });

  it('accepts each of the seven block types', () => {
    const blocks = [
      {
        type: 'stats',
        items: [{ label: 'New customers', value: '18', change: '+4 vs last week', good: true }],
      },
      { type: 'bars', title: 'Hand-overs', rows: [{ label: 'Missing facts', count: 5 }] },
      { type: 'heatmap', title: 'Busy hours', hours },
      {
        type: 'chats',
        title: 'Waiting',
        chats: [
          {
            jid: '601@s.whatsapp.net',
            name: 'Priya',
            preview: 'Order?',
            wait: '42 min',
            assignee: null,
          },
        ],
      },
      {
        type: 'customer',
        jid: '601@s.whatsapp.net',
        name: 'Farah',
        facts: ['64 messages'],
        points: ['Orders on Fridays.'],
        open: [],
        next: 'Confirm the order.',
      },
      {
        type: 'change',
        id: 'c1',
        agent: 'Aina',
        title: 'Delivery to Bayan Lepas',
        target: 'context_text',
        itemName: 'Delivery areas',
        added: 1,
        removed: 0,
        before: 'A',
        after: 'A\nB',
        reason: 'Customers asked.',
        status: 'proposed',
      },
      { type: 'test', question: 'Q?', before: 'Old', after: 'New' },
    ];
    for (const b of blocks) expect(AskEzyBlock.safeParse(b).success, b.type).toBe(true);
  });

  it('refuses a heatmap that is not 7 × 24 and an unknown block type', () => {
    expect(
      AskEzyBlock.safeParse({ type: 'heatmap', title: 'x', hours: hours.slice(1) }).success,
    ).toBe(false);
    expect(AskEzyBlock.safeParse({ type: 'html', html: '<b>x</b>' }).success).toBe(false);
  });

  it('reads the stream lines', () => {
    expect(AskEzyEvent.parse({ type: 'step', key: 'get_stats', count: 1 }).type).toBe('step');
    expect(AskEzyEvent.safeParse({ type: 'step', label: 'free text' }).success).toBe(false);
    expect(AskEzyEvent.parse({ type: 'error', code: 'ai_timeout' })).toEqual({
      type: 'error',
      code: 'ai_timeout',
    });
    const answer = { text: 'Hi', blocks: [], steps: [], followUps: [] };
    expect(AskEzyAnswer.parse(answer)).toEqual(answer);
    expect(AskEzyEvent.safeParse({ type: 'answer', answer: { ...answer, text: '' } }).success).toBe(
      false,
    );
  });
});

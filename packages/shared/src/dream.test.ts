import { describe, expect, it } from 'vitest';
import { DreamChangeDetail, DreamHistory, DreamSettingsBody, DREAM_DEFAULT_SETTINGS } from './dream.js';

describe('dream mode contract', () => {
  it('accepts a nightly time from 00:00 to 23:59 only', () => {
    expect(DreamSettingsBody.safeParse({ runTime: '02:00' }).success).toBe(true);
    expect(DreamSettingsBody.safeParse({ runTime: '23:59' }).success).toBe(true);
    expect(DreamSettingsBody.safeParse({ runTime: '24:00' }).success).toBe(false);
    expect(DreamSettingsBody.safeParse({ runTime: '2:00' }).success).toBe(false);
  });

  it('starts switched off at 02:00 without Apply by itself', () => {
    expect(DREAM_DEFAULT_SETTINGS).toEqual({ enabled: false, runTime: '02:00', autoApply: false });
  });

  it('round-trips a change with its checks and team quotes', () => {
    const detail = {
      id: 3,
      runId: 1,
      target: 'context_text',
      itemId: 9,
      itemName: 'Opening hours',
      summary: 'Saturday: 9 am to 1 pm',
      status: 'waiting',
      auto: false,
      sourceCount: 2,
      createdAt: 1,
      decidedAt: null,
      before: 'Closed on weekends.',
      after: 'Saturday: 9 am to 1 pm.',
      checks: [{ name: 'replay', ok: true }],
      sources: [{ role: 'team', name: 'Jazz', at: 1, text: 'Yes, 9 to 1.' }],
    };
    expect(DreamChangeDetail.parse(detail)).toEqual(detail);
  });

  it('rejects an unknown change status', () => {
    const run = {
      id: 1,
      slot: 1,
      status: 'done',
      reason: null,
      chatsRead: 3,
      takeovers: 1,
      saved: 1,
      dropped: 0,
      changes: [
        {
          id: 1,
          runId: 1,
          target: 'context_text',
          itemId: null,
          itemName: null,
          summary: 's',
          status: 'maybe',
          auto: false,
          sourceCount: 1,
          createdAt: 1,
          decidedAt: null,
        },
      ],
    };
    const history = { settings: DREAM_DEFAULT_SETTINGS, runs: [run], nextBefore: null, aiReady: true };
    expect(DreamHistory.safeParse(history).success).toBe(false);
  });
});

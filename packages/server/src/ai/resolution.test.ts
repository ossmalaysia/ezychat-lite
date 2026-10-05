import { describe, expect, it } from 'vitest';
import {
  ASK_RESOLUTION_REPLY,
  RESOLVED_REPLY,
  guardResolution,
  looksLikeConfirmation,
  objectsToResolution,
} from './resolution.js';

const resolve = { action: 'resolve' as const, reply: 'Glad to help!' };
const ask = { action: 'ask_resolution' as const, reply: 'Anything else?' };
const handoff = { action: 'handoff' as const, reply: 'A human will help.' };

describe('guardResolution', () => {
  it.each([
    'Ok noted, yes that answers it. Thank you!', // the live failure
    'Yes thanks, all good',
    'Thank you so much',
    'Ok baik, terima kasih',
    'Dah faham, terima kasih ya',
    'Sudah selesai, terima kasih',
    '好的，明白了，谢谢！',
    '没问题，谢谢',
    '可以了，谢谢',
  ])('accepts the model resolving after a resolution question: %s', (text) => {
    expect(objectsToResolution(text)).toBe(false);
    expect(guardResolution(resolve, 1, text)).toEqual(resolve);
  });

  it.each([
    'Ok, but what about delivery?',
    'No, it is still not working',
    'However I also need a quotation',
    'Can you also send the price list',
    'How about Saturday',
    'Tidak, belum selesai',
    'Bukan itu maksud saya',
    'Tapi berapa kos penghantaran',
    'Boleh hantar esok',
    '不是这个问题',
    '还没解决',
    '但是运费多少',
    '谢谢？',
  ])('never resolves when the customer objects, hesitates or asks more: %s', (text) => {
    expect(objectsToResolution(text)).toBe(true);
    expect(guardResolution(resolve, 1, text)).toEqual({
      action: 'ask_resolution',
      reply: ASK_RESOLUTION_REPLY,
    });
    expect(guardResolution(ask, 5, text)).toEqual(ask);
  });

  it('never resolves before the AI has asked', () => {
    expect(guardResolution(resolve, 0, 'Thank you!')).toEqual({
      action: 'ask_resolution',
      reply: ASK_RESOLUTION_REPLY,
    });
  });

  it('resolves after two resolution questions answered with confirming-looking replies', () => {
    expect(guardResolution(ask, 1, 'ok thanks')).toEqual(ask);
    expect(guardResolution(ask, 2, 'ok thanks')).toEqual({
      action: 'resolve',
      reply: RESOLVED_REPLY,
    });
    expect(guardResolution(ask, 2, 'hmm')).toEqual(ask);
    expect(guardResolution(handoff, 9, 'ok thanks')).toEqual(handoff);
  });

  it('recognises confirmations in English, Malay and Chinese', () => {
    for (const text of ['ok thanks', 'baik terima kasih', '好的谢谢', 'Yes, thank you!'])
      expect(looksLikeConfirmation(text)).toBe(true);
    for (const text of ['hmm', 'tomorrow 3pm', '明天下午'])
      expect(looksLikeConfirmation(text)).toBe(false);
  });
});

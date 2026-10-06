import { describe, expect, it } from 'vitest';
import {
  ASK_RESOLUTION_REPLY,
  RESOLVED_REPLY,
  guardResolution,
  looksLikeConfirmation,
  objectsToResolution,
  requestsAction,
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

describe('review fixes', () => {
  it('applies the cap only to a model resolution question, never to an answer', () => {
    const answer = { action: 'answer' as const, reply: 'Sure, 3 boxes is RM30.' };
    expect(guardResolution(answer, 2, "Ok great, I'll take 3 boxes")).toEqual(answer);
    expect(guardResolution(answer, 9, 'ok thanks')).toEqual(answer);
  });

  it.each([
    "Thanks, it didn't help",
    'Thanks, it didn’t help',
    'Please don’t close it yet, thanks',
    "Ok, but it won't open",
    "Thanks, I can't log in",
    "I haven't received it, thanks",
    "It wasn't delivered, ok",
    'Thanks, also need 2 more delivered',
    'Ok thanks, one more thing',
    'Wait, thanks',
    'Actually ok thanks',
    'ok thanks, want 2 more',
  ])('treats contractions and follow-ups as objections: %s', (text) => {
    expect(objectsToResolution(text)).toBe(true);
    expect(looksLikeConfirmation(text)).toBe(false);
    expect(guardResolution(resolve, 1, text).action).toBe('ask_resolution');
  });

  it.each([
    'No thanks',
    'no thank you',
    "Nope, that's all",
    'No, that’s all',
    "That's all",
    'All good',
    'all good, thanks',
    'Tak ada lagi',
    'takde lagi, terima kasih',
    'Tiada lagi',
    '没有了',
    '没有了，谢谢',
    '没事了',
  ])('treats closing phrases as confirmations: %s', (text) => {
    expect(objectsToResolution(text)).toBe(false);
    expect(looksLikeConfirmation(text)).toBe(true);
    expect(guardResolution(resolve, 1, text)).toEqual(resolve);
    expect(guardResolution(ask, 2, text)).toEqual({ action: 'resolve', reply: RESOLVED_REPLY });
  });

  it('asks only whether the answer helped, without inviting new questions', () => {
    expect(ASK_RESOLUTION_REPLY).toBe('Does that answer your question?');
  });

  it.each([
    'I want to order 5 regular Kopi Gula Apong, deliver tomorrow 3pm',
    'Yes please proceed with the order',
    'Can I place an order for 10 cups?',
    "I'd like to book a table for 6",
    'Please cancel my order',
    'Ok go ahead',
    'I will take 2 gift boxes',
    'Saya nak order 3 teh tarik',
    'Nak tempah untuk esok',
    'Tolong batalkan pesanan saya',
    '我要订 5 杯咖啡',
    '帮我下单',
    '可以付款吗',
  ])('recognises a request the AI cannot carry out: %s', (text) => {
    expect(requestsAction(text)).toBe(true);
  });

  it.each([
    'How much is a large Kopi Gula Apong?',
    'Do you deliver to Butterworth?',
    'What time do you open on Saturday?',
    'ok noted, thanks!',
    'Berapa harga teh tarik?',
    '你们几点开门？',
  ])('does not treat a question or a thank-you as a request: %s', (text) => {
    expect(requestsAction(text)).toBe(false);
  });

  it('hands an order to the team instead of resolving it, keeping the model reply', () => {
    const conversation = 'I want to order 5 regular Kopi Gula Apong\nok great, thanks, that is all';
    expect(guardResolution(resolve, 1, 'ok great, thanks, that is all', conversation)).toEqual({
      action: 'handoff',
      reply: resolve.reply,
      handoffReason: 'needs_action',
    });
    // The cap path (customer confirms after repeated questions) is guarded the same way.
    expect(guardResolution(ask, 2, 'ok thanks', conversation)).toEqual({
      action: 'handoff',
      reply: RESOLVED_REPLY,
      handoffReason: 'needs_action',
    });
    // Answers and resolution questions are never changed; a plain question still resolves.
    expect(guardResolution(ask, 0, 'I want to order 5', conversation)).toEqual(ask);
    expect(
      guardResolution(resolve, 1, 'ok thanks', 'How much is a large kopi?\nok thanks'),
    ).toEqual(resolve);
  });
});

import { describe, expect, it } from 'vitest';
import { MeResponse, PatchMeBody, SendTextBody } from './api.js';
import {
  ChatTranslateBody,
  LIVE_TRANSLATE_SAME_LANGUAGE_SHARE,
  LiveTranslateSettings,
  MessageTranslation,
  TranslateDraft,
  changedItem,
  guessLanguage,
  protectedItems,
  shareInLanguage,
  translateLanguageForLocale,
} from './live-translate.js';
import { MessageSchema } from './models.js';

describe('protectedItems', () => {
  it('takes prices with commas, phones with spaces, dates, times, links, emails, mentions, codes and emoji', () => {
    const text =
      'Harga RM1,260.00 untuk ORD-12345. Call +60 12-345 6789 on 19/11/2026 at 10:30, ' +
      'see https://shop.example.com/p?id=9. or mail sales@example.com @Aminah 👍🏽';
    expect(protectedItems(text)).toEqual([
      'RM1,260.00',
      'ORD-12345',
      '+60 12-345 6789',
      '19/11/2026',
      '10:30',
      'https://shop.example.com/p?id=9',
      'sales@example.com',
      '@Aminah',
      '👍🏽',
    ]);
  });

  it('keeps only the number of a lowercase unit and never repeats an item', () => {
    expect(protectedItems('Datang 3pm, 5kg, 2 2 kotak, 3rd floor')).toEqual(['3', '5', '2']);
  });

  it('reads plain numbers and percentages, and ISO dates', () => {
    expect(protectedItems('Diskaun 15% sampai 2026-12-01, 1.5 kg')).toEqual([
      '15%',
      '2026-12-01',
      '1.5',
    ]);
  });

  it('finds nothing in plain words', () => {
    expect(protectedItems('Boleh saya tahu harganya?')).toEqual([]);
  });
});

describe('changedItem', () => {
  it('passes when every item is kept, ignoring spaces and CJK spacing', () => {
    expect(
      changedItem('Harga RM1,260.00, hantar 19/11/2026', '价格是RM 1,260.00，19/11/2026送达'),
    ).toBeNull();
    expect(changedItem('Call +60 12-345 6789', '请致电+6012-3456789')).toBeNull();
  });

  it('refuses a changed price and says what it became', () => {
    expect(changedItem('Harga RM1,260.00', '价格是RM4,260.00')).toEqual({
      item: 'RM1,260.00',
      became: 'RM4,260.00',
    });
  });

  it('refuses a missing item with an empty became', () => {
    expect(changedItem('Order ORD-12345 sent 👍', 'Pesanan dihantar 👍')).toEqual({
      item: 'ORD-12345',
      became: '',
    });
  });

  it('does not accept a number inside a longer number', () => {
    expect(changedItem('2 boxes', '12 kotak')).toEqual({ item: '2', became: '12' });
    expect(changedItem('RM5', 'RM5.50')?.item).toBe('RM5');
    expect(changedItem('5 boxes', '5 kotak')).toBeNull();
  });

  it('keeps emoji and mentions', () => {
    expect(changedItem('Terima kasih @Ali 🙏', 'Thank you @Ali')).toEqual({
      item: '🙏',
      became: '',
    });
  });
});

describe('shareInLanguage (the 70 % rule)', () => {
  it('reads Chinese as Chinese and not Malay', () => {
    expect(shareInLanguage('你好，请问这个多少钱？', 'zh')).toBe(1);
    expect(shareInLanguage('你好，请问这个多少钱？', 'ms')).toBe(0);
  });

  it('keeps a mostly-Malay message with one Chinese word', () => {
    const text = 'Boleh saya tahu harga untuk barang ini, terima kasih 谢谢';
    expect(shareInLanguage(text, 'ms')).toBeGreaterThanOrEqual(LIVE_TRANSLATE_SAME_LANGUAGE_SHARE);
    expect(shareInLanguage(text, 'zh')).toBeLessThan(0.2);
  });

  it('tells English from Malay by common words', () => {
    expect(shareInLanguage('Can you send the price today please', 'ms')).toBeLessThan(0.3);
    expect(shareInLanguage('Can you send the price today please', 'en')).toBe(1);
    expect(shareInLanguage('Boleh hantar harga hari ini', 'id')).toBe(1);
  });

  it('counts Latin text with no known word as mine for Latin languages, and text without letters as 1', () => {
    expect(shareInLanguage('Zul', 'en')).toBe(1);
    expect(shareInLanguage('Zul', 'zh')).toBe(0);
    expect(shareInLanguage('RM1,260 👍', 'zh')).toBe(1);
  });

  it('reads scripts: Tamil, Thai, Arabic, Korean, Japanese, Vietnamese', () => {
    expect(shareInLanguage('வணக்கம்', 'ta')).toBe(1);
    expect(shareInLanguage('สวัสดีครับ', 'th')).toBe(1);
    expect(shareInLanguage('مرحبا', 'ar')).toBe(1);
    expect(shareInLanguage('안녕하세요', 'ko')).toBe(1);
    expect(shareInLanguage('こんにちは世界', 'ja')).toBe(1);
    expect(shareInLanguage('こんにちは世界', 'zh')).toBe(0);
    expect(shareInLanguage('xin chào, giá bao nhiêu', 'vi')).toBe(1);
  });
});

describe('guessLanguage', () => {
  it('guesses by script and by common words', () => {
    expect(guessLanguage('请问几点开门？')).toBe('zh');
    expect(guessLanguage('すみません')).toBe('ja');
    expect(guessLanguage('வணக்கம் நண்பரே')).toBe('ta');
    expect(guessLanguage('Can you help me with my order')).toBe('en');
    expect(guessLanguage('Saya nak tanya pasal pesanan')).toBe('ms');
    expect(guessLanguage('Zulkifli')).toBeNull();
    expect(guessLanguage('12345')).toBeNull();
  });
});

describe('schemas', () => {
  it('defaults the admin settings to on and 200', () => {
    expect(LiveTranslateSettings.parse({})).toEqual({ enabled: true, dailyLimit: 200 });
  });

  it('keeps older messages and /me answers working with defaults', () => {
    const me = MeResponse.parse({
      id: 1,
      username: 'a',
      displayName: 'A',
      role: 'admin',
      mustChangePassword: false,
      disabled: false,
      createdAt: 1,
      locale: null,
    });
    expect(me.translateLanguage).toBeNull();
    expect(me.sendWithoutPreview).toBe(false);
    const msg = MessageSchema.parse({
      id: 'm',
      chatJid: 'c',
      senderJid: null,
      senderName: null,
      fromMe: true,
      sentByUserId: 1,
      type: 'text',
      body: 'hi',
      mediaUrl: null,
      mediaMime: null,
      mediaName: null,
      mediaStatus: 'none',
      quotedId: null,
      status: 'sent',
      error: null,
      timestamp: 1,
      clientId: null,
    });
    expect(msg.typed ?? null).toBeNull();
    expect(msg.sentOriginal ?? false).toBe(false);
  });

  it('accepts partial me patches, the send block and the answers', () => {
    expect(PatchMeBody.parse({ translateLanguage: 'zh' })).toEqual({ translateLanguage: 'zh' });
    expect(() => PatchMeBody.parse({ other: 1 })).toThrow();
    const body = SendTextBody.parse({
      text: '你好',
      clientId: 'c1',
      translation: { draftId: 'd', typedText: 'Hai', typedLanguage: 'ms' },
    });
    expect(body.translation?.edited).toBe(false);
    expect(ChatTranslateBody.parse({ customerLanguage: null })).toEqual({ customerLanguage: null });
    expect(MessageTranslation.parse({ status: 'ok', text: 'x', from: 'zh' }).status).toBe('ok');
    expect(TranslateDraft.parse({ status: 'refused', item: 'RM1', became: '' }).status).toBe(
      'refused',
    );
  });

  it('maps an app language to My language', () => {
    expect(translateLanguageForLocale('zh-CN')).toBe('zh');
    expect(translateLanguageForLocale('ms')).toBe('ms');
    expect(translateLanguageForLocale(null)).toBe('en');
    expect(translateLanguageForLocale('fr')).toBe('en');
  });
});

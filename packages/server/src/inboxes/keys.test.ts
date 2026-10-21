import { describe, expect, it } from 'vitest';
import {
  PRIMARY_INBOX_ID,
  chatKey,
  inboxOfKey,
  messageKey,
  parseChatKey,
  waMessageId,
} from './keys.js';

describe('inbox keys', () => {
  it('keeps the WhatsApp JID as the chat key of inbox 1', () => {
    expect(PRIMARY_INBOX_ID).toBe(1);
    expect(chatKey(1, '6012@s.whatsapp.net')).toBe('6012@s.whatsapp.net');
    expect(chatKey(2, '6012@s.whatsapp.net')).toBe('6012@s.whatsapp.net#2');
    expect(chatKey(12, 'x@g.us')).toBe('x@g.us#12');
  });

  it('reads the inbox and the WhatsApp JID back from a chat key', () => {
    expect(parseChatKey('x@g.us#3')).toEqual({ inboxId: 3, waJid: 'x@g.us' });
    expect(parseChatKey('x@g.us')).toEqual({ inboxId: 1, waJid: 'x@g.us' });
    expect(inboxOfKey('x@g.us#3')).toBe(3);
    expect(inboxOfKey('x@g.us')).toBe(1);
    for (const k of ['6012@s.whatsapp.net', 'a@lid#2', 'g@g.us#40']) {
      const { inboxId, waJid } = parseChatKey(k);
      expect(chatKey(inboxId, waJid)).toBe(k);
    }
  });

  it('refuses malformed keys', () => {
    for (const bad of ['a#0', 'a#x', 'a#2#3', 'a#', '#2', 'a#1', 'a#02', 'a#-2', 'a#2.5', ''])
      expect(() => parseChatKey(bad), bad).toThrow();
    expect(() => chatKey(0, 'a')).toThrow();
    expect(() => chatKey(1.5, 'a')).toThrow();
    expect(() => chatKey(2, 'a#2')).toThrow();
    expect(() => chatKey(2, '')).toThrow();
  });

  it('applies the same rule to message ids', () => {
    expect(messageKey(1, 'ABC')).toBe('ABC');
    expect(messageKey(2, 'ABC')).toBe('ABC#2');
    expect(waMessageId('ABC#2')).toBe('ABC');
    expect(waMessageId('ABC')).toBe('ABC');
    expect(inboxOfKey('ABC#7')).toBe(7);
    for (const bad of ['A#0', 'A#x', 'A#2#3', 'A#1']) expect(() => waMessageId(bad), bad).toThrow();
    expect(() => messageKey(-1, 'A')).toThrow();
    expect(() => messageKey(2, 'A#3')).toThrow();
  });
});

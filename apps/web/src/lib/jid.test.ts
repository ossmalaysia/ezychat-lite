import { describe, expect, it } from 'vitest';
import { formatJid, formatPhone } from './jid';

describe('jid formatting', () => {
  it('prints phone-number JIDs as +digits and never prints WhatsApp ID (LID) digits', () => {
    expect(formatJid('60123456789@s.whatsapp.net')).toBe('+60123456789');
    expect(formatJid('60123456789:3@s.whatsapp.net')).toBe('+60123456789');
    expect(formatJid('123456789012345@lid')).toBe('');
    expect(formatJid('123456789012345:7@lid')).toBe('');
  });

  it('formatPhone uses the chat phone or null', () => {
    expect(formatPhone({ phone: '60123456789' })).toBe('+60123456789');
    expect(formatPhone({ phone: null })).toBeNull();
  });
});

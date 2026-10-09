import { describe, expect, it } from 'vitest';
import { quotedForChat, quotedFromRef } from './quoted.js';

const DM = '60123456789@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';

describe('quotedFromRef', () => {
  it('rebuilds a customer message in a direct chat (remoteJid = the chat, no participant)', () => {
    expect(
      quotedFromRef(
        { id: 'ABC', fromMe: false, senderJid: DM, type: 'text', text: 'Can you deliver?' },
        DM,
      ),
    ).toEqual({
      key: { remoteJid: DM, id: 'ABC', fromMe: false },
      message: { conversation: 'Can you deliver?' },
    });
  });

  it('names the sender of a group message so WhatsApp attributes the quote', () => {
    const q = quotedFromRef(
      { id: 'G1', fromMe: false, senderJid: '6011@s.whatsapp.net', type: 'text', text: 'hi' },
      GROUP,
    );
    expect(q.key).toEqual({
      remoteJid: GROUP,
      id: 'G1',
      fromMe: false,
      participant: '6011@s.whatsapp.net',
    });
  });

  it('keeps our own messages as fromMe without a participant', () => {
    const q = quotedFromRef(
      { id: 'OUT', fromMe: true, senderJid: null, type: 'text', text: 'ok' },
      GROUP,
    );
    expect(q.key).toEqual({ remoteJid: GROUP, id: 'OUT', fromMe: true });
  });

  it('labels media without a caption, and keeps a caption when there is one', () => {
    const photo = quotedFromRef(
      { id: 'P', fromMe: false, senderJid: DM, type: 'image', text: null },
      DM,
    );
    expect(photo.message).toEqual({ conversation: '📷 Photo' });
    const captioned = quotedFromRef(
      { id: 'P2', fromMe: false, senderJid: DM, type: 'image', text: 'menu 2026' },
      DM,
    );
    expect(captioned.message).toEqual({ conversation: 'menu 2026' });
  });
});

describe('quotedForChat', () => {
  const LID = '987654321@lid';

  it('re-points a message cached under the phone number at the WhatsApp ID the reply goes to', () => {
    const cached = {
      key: { remoteJid: DM, id: 'OLD', fromMe: false },
      message: { conversation: 'hi' },
      messageTimestamp: 1,
    };
    const q = quotedForChat(cached, LID);
    expect(q.key).toEqual({ remoteJid: LID, id: 'OLD', fromMe: false });
    expect(q.message).toBe(cached.message);
    expect(cached.key.remoteJid).toBe(DM); // the cache itself is not mutated
  });

  it('returns the cached message unchanged when it already belongs to the chat', () => {
    const cached = {
      key: { remoteJid: GROUP, id: 'G', fromMe: false, participant: '6011@s.whatsapp.net' },
    };
    expect(quotedForChat(cached, GROUP)).toBe(cached);
  });
});

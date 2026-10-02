import { describe, expect, it } from 'vitest';
import { jidType, mapWAMessage } from './mapping.js';

const base = (over: Record<string, unknown> = {}) => ({
  key: { remoteJid: '60123456789@s.whatsapp.net', fromMe: false, id: 'ABC' },
  messageTimestamp: 1_700_000_000,
  pushName: 'Alice',
  ...over,
});

describe('mapWAMessage', () => {
  it('maps plain conversation text', () => {
    const m = mapWAMessage(base({ message: { conversation: 'hello' } }));
    expect(m).toMatchObject({
      id: 'ABC',
      chatJid: '60123456789@s.whatsapp.net',
      senderJid: '60123456789@s.whatsapp.net',
      senderName: 'Alice',
      fromMe: false,
      type: 'text',
      body: 'hello',
      quotedId: null,
      timestamp: 1_700_000_000_000,
      media: null,
    });
  });

  it('handles Long-like timestamps', () => {
    const m = mapWAMessage(
      base({ messageTimestamp: { low: 1_700_000_000, high: 0, unsigned: true, toNumber: () => 1_700_000_000 }, message: { conversation: 'x' } }),
    );
    expect(m?.timestamp).toBe(1_700_000_000_000);
  });

  it('maps extended text with quote', () => {
    const m = mapWAMessage(
      base({ message: { extendedTextMessage: { text: 'reply', contextInfo: { stanzaId: 'Q1' } } } }),
    );
    expect(m?.type).toBe('text');
    expect(m?.body).toBe('reply');
    expect(m?.quotedId).toBe('Q1');
  });

  it('maps image with caption and media download', () => {
    const m = mapWAMessage(base({ message: { imageMessage: { caption: 'look', mimetype: 'image/jpeg' } } }));
    expect(m?.type).toBe('image');
    expect(m?.body).toBe('look');
    expect(m?.media?.mime).toBe('image/jpeg');
    expect(typeof m?.media?.download).toBe('function');
  });

  it('maps document with file name', () => {
    const m = mapWAMessage(
      base({ message: { documentMessage: { fileName: 'a.pdf', mimetype: 'application/pdf' } } }),
    );
    expect(m?.type).toBe('document');
    expect(m?.media?.fileName).toBe('a.pdf');
  });

  it('maps audio, video and sticker', () => {
    expect(mapWAMessage(base({ message: { audioMessage: { ptt: true, mimetype: 'audio/ogg' } } }))?.type).toBe('audio');
    expect(mapWAMessage(base({ message: { videoMessage: { mimetype: 'video/mp4' } } }))?.type).toBe('video');
    expect(mapWAMessage(base({ message: { stickerMessage: { mimetype: 'image/webp' } } }))?.type).toBe('sticker');
  });

  it('uses key.participant as sender in groups', () => {
    const m = mapWAMessage(
      base({
        key: { remoteJid: '1203630@g.us', fromMe: false, id: 'G1', participant: '60111@s.whatsapp.net' },
        message: { conversation: 'hi group' },
      }),
    );
    expect(m?.chatJid).toBe('1203630@g.us');
    expect(m?.senderJid).toBe('60111@s.whatsapp.net');
  });

  it('fromMe messages have null sender name', () => {
    const m = mapWAMessage(
      base({ key: { remoteJid: '60123@s.whatsapp.net', fromMe: true, id: 'ME1' }, message: { conversation: 'out' } }),
    );
    expect(m?.fromMe).toBe(true);
  });

  it('ignores reactions, protocol messages and key distribution', () => {
    expect(mapWAMessage(base({ message: { reactionMessage: { text: '👍', key: { id: 'ABC' } } } }))).toBeNull();
    expect(mapWAMessage(base({ message: { protocolMessage: { type: 0 } } }))).toBeNull();
    expect(
      mapWAMessage(base({ message: { senderKeyDistributionMessage: { groupId: 'x' } } })),
    ).toBeNull();
  });

  it('ignores status broadcast and messages without content', () => {
    expect(
      mapWAMessage(base({ key: { remoteJid: 'status@broadcast', id: 'S', fromMe: false }, message: { conversation: 'x' } })),
    ).toBeNull();
    expect(mapWAMessage(base({ message: null }))).toBeNull();
  });

  it('unwraps ephemeral messages', () => {
    const m = mapWAMessage(base({ message: { ephemeralMessage: { message: { conversation: 'eph' } } } }));
    expect(m?.body).toBe('eph');
  });
});

describe('jidType', () => {
  it.each([
    ['1203630@g.us', 'group'],
    ['60123@s.whatsapp.net', 'dm'],
    ['12345@lid', 'dm'],
    ['status@broadcast', 'other'],
    ['123@newsletter', 'other'],
    ['123@broadcast', 'other'],
    ['garbage', 'other'],
  ] as const)('%s -> %s', (jid, t) => {
    expect(jidType(jid)).toBe(t);
  });
});

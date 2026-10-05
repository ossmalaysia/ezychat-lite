import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type * as Baileys from 'baileys';
import { createBaileysAdapter } from '../index.js';
import { WaUnavailableError } from '../types.js';
import type {
  WaContactAlias,
  WaContactInfo,
  WaIncomingMessage,
  WaMessageStatusUpdate,
} from '../types.js';
import {
  BaileysAdapter,
  WA_BROWSER,
  isConnectionError,
  mediaContent,
  normalizePairingPhone,
  receiptStatus,
} from './adapter.js';
import { createAuthStore } from './auth-store.js';
import { contactAliasPair, normalizeContactJid } from './contact-aliases.js';

const socketFactory = vi.hoisted(() => vi.fn());
vi.mock('baileys', async (importOriginal) => ({
  ...(await importOriginal<typeof Baileys>()),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  makeWASocket: socketFactory,
}));

describe('pairing identity', () => {
  // WhatsApp terminates registration (428 before any QR) for 'Desktop' browser identities;
  // a Chrome web identity gets a QR and is accepted for phone-number pairing codes.
  it('identifies as a Chrome web client', () => {
    expect(WA_BROWSER[0]).toBe('Ubuntu');
    expect(WA_BROWSER[1]).toBe('Chrome');
  });

  it('resets reconnect backoff when a QR arrives', () => {
    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 0 });
    Object.assign(a as unknown as Record<string, unknown>, { attempt: 41 });
    (a as unknown as { onConnectionUpdate: (s: unknown, u: unknown) => void }).onConnectionUpdate(
      {},
      { qr: 'QR' },
    );
    expect((a as unknown as { attempt: number }).attempt).toBe(0);
    expect(a.status).toMatchObject({ state: 'qr', qr: 'QR' });
  });
});

describe('requestPairingCode', () => {
  it('normalizes phone numbers to digits with country code', () => {
    expect(normalizePairingPhone('+60 12-345 6789')).toBe('60123456789');
    expect(() => normalizePairingPhone('12345')).toThrow(/phone/i);
    expect(() => normalizePairingPhone('+1234567890123456')).toThrow(/phone/i);
  });

  it('asks the socket for a code once it is ready to pair', async () => {
    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 0 });
    const calls: string[] = [];
    Object.assign(a as unknown as Record<string, unknown>, {
      stopped: false,
      sock: { requestPairingCode: async (p: string) => (calls.push(p), 'ABCD1234') },
      _status: { state: 'qr', me: null, qr: 'QR', lastError: null },
    });
    await expect(a.requestPairingCode('+60 12-345 6789')).resolves.toBe('ABCD1234');
    expect(calls).toEqual(['60123456789']);
  });

  it('refuses when a number is already linked', async () => {
    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 0 });
    Object.assign(a as unknown as Record<string, unknown>, {
      _status: {
        state: 'open',
        me: { jid: '1@s.whatsapp.net', name: null },
        qr: null,
        lastError: null,
      },
    });
    await expect(a.requestPairingCode('60123456789')).rejects.toThrow(/already linked/i);
  });
});

describe('createBaileysAdapter (offline smoke)', () => {
  it('starts disconnected and refuses to send without connecting', async () => {
    const a = createBaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 7 });
    expect(a.status.state).toBe('disconnected');
    await expect(a.sendText('1@s.whatsapp.net', 'hi')).rejects.toBeInstanceOf(WaUnavailableError);
    expect(await a.downloadMedia('nope')).toBeNull();
    expect(await a.getProfilePicture('1@s.whatsapp.net')).toBeNull();
    await a.disconnect();
    expect(a.status.state).toBe('disconnected');
  });
});

const dm = (id: string, over: Record<string, unknown> = {}) =>
  ({
    key: { remoteJid: '60123456789@s.whatsapp.net', fromMe: false, id },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Alice',
    message: { conversation: `msg ${id}` },
    ...over,
  }) as never;

function collect(a: BaileysAdapter) {
  const msgs: Array<{ m: WaIncomingMessage; source: string }> = [];
  const statuses: WaMessageStatusUpdate[] = [];
  a.on('message', (m, meta) => msgs.push({ m, source: meta.source }));
  a.on('messageStatus', (s) => statuses.push(s));
  return { msgs, statuses };
}

describe('BaileysAdapter event handling', () => {
  it("treats upsert 'append' (offline-queued) messages as live, even with history_days=0", () => {
    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 0 });
    const { msgs } = collect(a);
    a.handleUpsert(
      [dm('OFF1', { messageTimestamp: Math.floor(Date.now() / 1000) - 3600 })],
      'append',
    );
    a.handleUpsert([dm('LIVE1')], 'notify');
    expect(msgs.map((x) => [x.m.id, x.source])).toEqual([
      ['OFF1', 'live'],
      ['LIVE1', 'live'],
    ]);
  });

  it('history batches use the current history_days getter', () => {
    let days = 0;
    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: () => days });
    const { msgs } = collect(a);
    const old = dm('H1', { messageTimestamp: Math.floor(Date.now() / 1000) - 2 * 86400 });
    a.onHistory({ chats: [], contacts: [], messages: [old], isLatest: true } as never);
    expect(msgs).toEqual([]);
    days = 7;
    a.onHistory({ chats: [], contacts: [], messages: [old], isLatest: true } as never);
    expect(msgs.map((x) => [x.m.id, x.source])).toEqual([['H1', 'history']]);
  });

  it('maps group per-participant receipts to delivered / read for our own messages', () => {
    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 7 });
    const { statuses } = collect(a);
    const key = (id: string, fromMe = true) => ({
      remoteJid: '1203@g.us',
      id,
      fromMe,
      participant: '6011@s.whatsapp.net',
    });
    a.handleReceipts([
      { key: key('G1'), receipt: { userJid: '6011@s.whatsapp.net', receiptTimestamp: 1 } },
      { key: key('G2'), receipt: { userJid: '6011@s.whatsapp.net', readTimestamp: 2 } },
      { key: key('G3', false), receipt: { userJid: '6011@s.whatsapp.net', readTimestamp: 2 } },
    ] as never);
    expect(statuses).toEqual([
      { id: 'G1', chatJid: '1203@g.us', status: 'delivered' },
      { id: 'G2', chatJid: '1203@g.us', status: 'read' },
    ]);
    expect(receiptStatus({ userJid: 'x' } as never)).toBeNull();
  });

  it('wraps connection-closed send errors as WaUnavailableError', async () => {
    expect(isConnectionError({ output: { statusCode: 428 }, message: 'Connection Closed' })).toBe(
      true,
    );
    expect(isConnectionError({ output: { statusCode: 408 } })).toBe(true);
    expect(isConnectionError(new Error('Connection Closed'))).toBe(true);
    expect(isConnectionError({ output: { statusCode: 400 }, message: 'bad request' })).toBe(false);

    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 7 });
    const boom = Object.assign(new Error('Connection Closed'), {
      output: { statusCode: 428 },
      isBoom: true,
    });
    const fakeSock = { sendMessage: async () => Promise.reject(boom) };
    Object.assign(a as unknown as Record<string, unknown>, {
      sock: fakeSock,
      _status: { state: 'open', me: null, qr: null, lastError: null },
    });
    await expect(a.sendText('1@s.whatsapp.net', 'hi')).rejects.toBeInstanceOf(WaUnavailableError);

    const other = new Error('not-acceptable');
    Object.assign(a as unknown as Record<string, unknown>, {
      sock: { sendMessage: async () => Promise.reject(other) },
    });
    await expect(a.sendText('1@s.whatsapp.net', 'hi')).rejects.toBe(other);
  });
});

const PN = '60123456789@s.whatsapp.net';
const LID = '123456789@lid';
const ALIAS = { jid: PN, alias: LID };

function contactHarness() {
  const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 3 });
  const aliases: WaContactAlias[] = [];
  const contacts: WaContactInfo[] = [];
  a.on('contactAliases', (batch) => aliases.push(...batch));
  a.on('contacts', (batch) => contacts.push(...batch));
  return { a, aliases, contacts };
}

describe('contact identity mapping', () => {
  it('normalizes both explicit orientations and rejects unrelated or invalid IDs', () => {
    expect(
      contactAliasPair(`${PN.split('@')[0]}:2@s.whatsapp.net`, `${LID.split('@')[0]}:9@lid`),
    ).toEqual(ALIAS);
    expect(contactAliasPair(LID, PN)).toEqual(ALIAS);
    expect(normalizeContactJid('60123456789@c.us')).toBe(PN);
    for (const other of [
      'group@g.us',
      'status@broadcast',
      'Alice@lid',
      '+60123456789@s.whatsapp.net',
      PN,
    ]) {
      expect(contactAliasPair(PN, other)).toBeNull();
    }
  });

  it('preserves names and all explicit history associations before chats are emitted', async () => {
    const { a, aliases, contacts } = contactHarness();
    const order: string[] = [];
    a.on('contactAliases', () => order.push('aliases'));
    a.on('contacts', () => order.push('contacts'));
    a.on('chats', () => order.push('chats'));
    a.onHistory({
      contacts: [{ id: PN, name: ' Saved business name ', notify: ' Push name ' }],
      lidPnMappings: [{ lid: LID, pn: PN }],
      chats: [{ id: LID }],
      messages: [],
      isLatest: true,
    } as never);
    expect(aliases[0]).toEqual({ ...ALIAS, source: 'history' });
    expect(contacts).toEqual([
      { jid: PN, aliases: [LID], savedName: 'Saved business name', pushName: 'Push name' },
    ]);
    expect(order.slice(0, 3)).toEqual(['aliases', 'contacts', 'chats']);
    await expect(a.getContactAliases([PN, LID])).resolves.toEqual([
      { ...ALIAS, source: 'keystore' },
    ]);
  });

  it('extracts contacts in either orientation and enriches later name-only updates', () => {
    for (const contact of [
      { id: PN, lid: LID },
      { id: LID, phoneNumber: PN },
      { id: `${LID.split('@')[0]}:4@lid`, lid: LID, phoneNumber: PN },
    ]) {
      const { a, aliases, contacts } = contactHarness();
      a.onHistory({ contacts: [contact], chats: [], messages: [] } as never);
      a.onHistory({
        contacts: [{ id: PN, name: 'Updated saved name' }],
        chats: [],
        messages: [],
      } as never);
      expect(aliases).toEqual([{ ...ALIAS, source: 'contacts' }]);
      expect(contacts.at(-1)).toMatchObject({
        jid: PN,
        aliases: [LID],
        savedName: 'Updated saved name',
      });
    }
  });

  it('learns message alternate chat and group participant identities even for unrendered protocol messages', () => {
    const { a, aliases } = contactHarness();
    a.handleUpsert(
      [
        {
          key: { remoteJid: LID, remoteJidAlt: PN, id: 'IDENTITY' },
          message: { protocolMessage: {} },
        },
        {
          key: {
            remoteJid: '1203@g.us',
            participant: '999@lid',
            participantAlt: '60111111111@s.whatsapp.net',
            id: 'GROUP',
          },
          message: { conversation: 'hi' },
        },
      ] as never,
      'notify',
    );
    expect(aliases).toEqual([
      { ...ALIAS, source: 'message' },
      { jid: '60111111111@s.whatsapp.net', alias: '999@lid', source: 'message' },
    ]);
  });

  it('reads both persisted signal-key orientations from an isolated auth directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wati-contact-alias-'));
    try {
      const auth = createAuthStore(directory);
      const { state } = await auth.load();
      await state.keys.set({
        'lid-mapping': { '60123456789': '123456789', '123456789_reverse': '60123456789' },
      });
      for (const jid of [PN, LID]) {
        const { a } = contactHarness();
        const reloaded = await auth.load();
        Object.assign(a, { signalKeys: reloaded.state.keys });
        await expect(a.getContactAliases([jid])).resolves.toEqual([
          { ...ALIAS, source: 'keystore' },
        ]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bounds file-key concurrency and performs no network lookups for missing mappings', async () => {
    const { a } = contactHarness();
    const get = vi.fn(async () => ({}));
    const network = vi.fn(() => {
      throw new Error('No network lookup allowed');
    });
    Object.assign(a, {
      signalKeys: { get },
      sock: { signalRepository: { lidMapping: { getLIDForPN: network, getPNForLID: network } } },
    });
    const ids = Array.from({ length: 600 }, (_, index) => `${60000000000 + index}@s.whatsapp.net`);
    await expect(a.getContactAliases([...ids, 'group@g.us'])).resolves.toEqual([]);
    expect(get.mock.calls.map((call) => (call as unknown as [string, string[]])[1].length)).toEqual(
      [256, 256, 88],
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('discards asynchronous local-key results after socket closure', async () => {
    const { a } = contactHarness();
    let resolve!: (value: Record<string, string>) => void;
    Object.assign(a, {
      signalKeys: {
        get: () =>
          new Promise<Record<string, string>>((done) => {
            resolve = done;
          }),
      },
    });
    const pending = a.getContactAliases([LID]);
    await a.disconnect();
    resolve({ '123456789_reverse': '60123456789' });
    await expect(pending).resolves.toEqual([]);
    await expect(a.getContactAliases([LID])).resolves.toEqual([]);
  });

  it('handles late socket mapping events and ignores old account events after logout', async () => {
    const { a, aliases, contacts } = contactHarness();
    const ev = new EventEmitter();
    const sock = {
      ev,
      end: vi.fn(),
      logout: vi.fn(),
      signalRepository: { lidMapping: { getLIDForPN: vi.fn() } },
    };
    socketFactory.mockReturnValueOnce(sock);
    const wipe = vi.fn(async () => {});
    Object.assign(a, {
      auth: {
        load: async () => ({
          state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
          saveCreds: async () => {},
        }),
        wipe,
      },
    });
    await a.connect();
    ev.emit('contacts.upsert', [{ id: PN, name: 'Saved name' }]);
    ev.emit('lid-mapping.update', { pn: PN, lid: LID });
    ev.emit('contacts.update', [{ id: PN, name: 'New name' }]);
    a.handleUpsert([dm('OLD-ACCOUNT')], 'notify');
    expect(aliases).toEqual([{ ...ALIAS, source: 'lid-mapping' }]);
    expect(contacts.at(-1)).toMatchObject({ savedName: 'New name', aliases: [LID] });
    await a.logout();
    ev.emit('lid-mapping.update', { pn: PN, lid: LID });
    ev.emit('contacts.upsert', [{ id: PN, name: 'Old account' }]);
    await expect(a.getContactAliases([PN])).resolves.toEqual([]);
    await expect(a.downloadMedia('OLD-ACCOUNT')).resolves.toBeNull();
    expect(contacts.at(-1)?.savedName).toBe('New name');
    expect(wipe).toHaveBeenCalledOnce();
    expect(sock.signalRepository.lidMapping.getLIDForPN).not.toHaveBeenCalled();
  });
});

describe('mediaContent', () => {
  const buffer = Buffer.from('OggS-voice');

  it('sends a voice note as push-to-talk OGG/Opus with its length', () => {
    expect(
      mediaContent({
        buffer,
        mime: 'audio/ogg; codecs=opus',
        fileName: 'voice.ogg',
        voice: { seconds: 12 },
      }),
    ).toEqual({ audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 12 });
  });

  it('rounds the voice-note length to whole seconds, at least 1', () => {
    const c = (seconds: number) =>
      mediaContent({ buffer, mime: 'audio/ogg; codecs=opus', fileName: 'v', voice: { seconds } });
    expect(c(0.2)).toMatchObject({ seconds: 1 });
    expect(c(4.6)).toMatchObject({ seconds: 5 });
  });

  it('keeps an audio attachment as a plain audio file', () => {
    const content = mediaContent({ buffer, mime: 'audio/mpeg', fileName: 'song.mp3' });
    expect(content).toEqual({ audio: buffer, mimetype: 'audio/mpeg' });
    expect(content).not.toHaveProperty('ptt');
  });

  it('maps images, stickers, video and documents as before', () => {
    expect(mediaContent({ buffer, mime: 'image/png', fileName: 'a.png', caption: 'hi' })).toEqual({
      image: buffer,
      mimetype: 'image/png',
      caption: 'hi',
    });
    expect(mediaContent({ buffer, mime: 'image/webp', fileName: 's.webp' })).toEqual({
      sticker: buffer,
      mimetype: 'image/webp',
    });
    expect(mediaContent({ buffer, mime: 'video/mp4', fileName: 'v.mp4' })).toEqual({
      video: buffer,
      mimetype: 'video/mp4',
    });
    expect(mediaContent({ buffer, mime: 'application/pdf', fileName: 'a.pdf' })).toEqual({
      document: buffer,
      mimetype: 'application/pdf',
      fileName: 'a.pdf',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createBaileysAdapter } from '../index.js';
import { WaUnavailableError } from '../types.js';
import type { WaIncomingMessage, WaMessageStatusUpdate } from '../types.js';
import { BaileysAdapter, WA_BROWSER, isConnectionError, normalizePairingPhone, receiptStatus } from './adapter.js';

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
    (a as unknown as { onConnectionUpdate: (s: unknown, u: unknown) => void }).onConnectionUpdate({}, { qr: 'QR' });
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
      _status: { state: 'open', me: { jid: '1@s.whatsapp.net', name: null }, qr: null, lastError: null },
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
    a.handleUpsert([dm('OFF1', { messageTimestamp: Math.floor(Date.now() / 1000) - 3600 })], 'append');
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
    const key = (id: string, fromMe = true) => ({ remoteJid: '1203@g.us', id, fromMe, participant: '6011@s.whatsapp.net' });
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
    expect(isConnectionError({ output: { statusCode: 428 }, message: 'Connection Closed' })).toBe(true);
    expect(isConnectionError({ output: { statusCode: 408 } })).toBe(true);
    expect(isConnectionError(new Error('Connection Closed'))).toBe(true);
    expect(isConnectionError({ output: { statusCode: 400 }, message: 'bad request' })).toBe(false);

    const a = new BaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 7 });
    const boom = Object.assign(new Error('Connection Closed'), { output: { statusCode: 428 }, isBoom: true });
    const fakeSock = { sendMessage: async () => Promise.reject(boom) };
    Object.assign(a as unknown as Record<string, unknown>, {
      sock: fakeSock,
      _status: { state: 'open', me: null, qr: null, lastError: null },
    });
    await expect(a.sendText('1@s.whatsapp.net', 'hi')).rejects.toBeInstanceOf(WaUnavailableError);

    const other = new Error('not-acceptable');
    Object.assign(a as unknown as Record<string, unknown>, { sock: { sendMessage: async () => Promise.reject(other) } });
    await expect(a.sendText('1@s.whatsapp.net', 'hi')).rejects.toBe(other);
  });
});

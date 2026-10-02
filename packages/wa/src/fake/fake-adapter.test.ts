import { describe, expect, it } from 'vitest';
import type { WaStatus } from '@wa-team-inbox/shared';
import { FakeWaAdapter, WaUnavailableError } from '../index.js';
import type { WaIncomingMessage, WaMessageStatusUpdate } from '../index.js';

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('FakeWaAdapter', () => {
  it('connect emits connecting then open with fake me', async () => {
    const wa = new FakeWaAdapter();
    const states: WaStatus[] = [];
    wa.on('status', (s) => states.push(s));
    await wa.connect();
    expect(states.map((s) => s.state)).toEqual(['connecting', 'open']);
    expect(wa.status.state).toBe('open');
    expect(wa.status.me).toEqual({ jid: '60000000000@s.whatsapp.net', name: 'Fake' });
  });

  it('connect is idempotent when already open', async () => {
    const wa = new FakeWaAdapter();
    await wa.connect();
    const states: string[] = [];
    wa.on('status', (s) => states.push(s.state));
    await wa.connect();
    expect(states).toEqual([]);
  });

  it('autoOpen false stays connecting', async () => {
    const wa = new FakeWaAdapter({ autoOpen: false });
    await wa.connect();
    expect(wa.status.state).toBe('connecting');
  });

  it('simulateIncoming emits message with source live', async () => {
    const wa = new FakeWaAdapter();
    await wa.connect();
    const got: Array<[WaIncomingMessage, { source: string }]> = [];
    wa.on('message', (m, meta) => got.push([m, meta]));
    const m = wa.simulateIncoming({ chatJid: '601111@s.whatsapp.net', body: 'hi' });
    expect(m.id).toMatch(/^FAKE-\d+$/);
    expect(got).toHaveLength(1);
    expect(got[0]![0]).toEqual(m);
    expect(got[0]![1]).toEqual({ source: 'live' });
    expect(m.type).toBe('text');
    expect(m.fromMe).toBe(false);
    expect(m.body).toBe('hi');
    const m2 = wa.simulateIncoming({ chatJid: '601111@s.whatsapp.net', body: 'again' });
    expect(m2.id).not.toBe(m.id);
  });

  it('sendText records and emits sent then delivered', async () => {
    const wa = new FakeWaAdapter();
    await wa.connect();
    const updates: WaMessageStatusUpdate[] = [];
    wa.on('messageStatus', (u) => updates.push(u));
    const res = await wa.sendText('601111@s.whatsapp.net', 'hello');
    expect(res.id).toMatch(/^FAKE-OUT-\d+$/);
    expect(typeof res.timestamp).toBe('number');
    expect(wa.sent).toEqual([{ chatJid: '601111@s.whatsapp.net', text: 'hello', id: res.id }]);
    expect(updates.map((u) => u.status)).toEqual(['sent']);
    await tick();
    expect(updates.map((u) => u.status)).toEqual(['sent', 'delivered']);
    expect(updates[1]).toEqual({ id: res.id, chatJid: '601111@s.whatsapp.net', status: 'delivered' });
  });

  it('sendText while disconnected rejects WaUnavailableError', async () => {
    const wa = new FakeWaAdapter();
    await expect(wa.sendText('601111@s.whatsapp.net', 'x')).rejects.toBeInstanceOf(WaUnavailableError);
    await wa.connect();
    wa.setConnected(false);
    const err = await wa.sendText('601111@s.whatsapp.net', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WaUnavailableError);
    expect((err as WaUnavailableError).code).toBe('wa_unavailable');
    expect(wa.sent).toHaveLength(0);
    wa.setConnected(true);
    await expect(wa.sendText('601111@s.whatsapp.net', 'x')).resolves.toBeTruthy();
  });

  it('failNextSend rejects once', async () => {
    const wa = new FakeWaAdapter();
    await wa.connect();
    wa.failNextSend(new Error('boom'));
    await expect(wa.sendText('601111@s.whatsapp.net', 'x')).rejects.toThrow('boom');
    await expect(wa.sendText('601111@s.whatsapp.net', 'y')).resolves.toBeTruthy();
    expect(wa.sent).toHaveLength(1);
  });

  it('sendMedia records file', async () => {
    const wa = new FakeWaAdapter();
    await wa.connect();
    const file = { buffer: Buffer.from('abc'), mime: 'image/png', fileName: 'a.png' };
    const res = await wa.sendMedia('601111@s.whatsapp.net', file);
    expect(wa.sent[0]).toEqual({ chatJid: '601111@s.whatsapp.net', file, id: res.id });
  });

  it('simulateStatus merges and emits', () => {
    const wa = new FakeWaAdapter();
    const states: WaStatus[] = [];
    wa.on('status', (s) => states.push(s));
    wa.simulateStatus({ state: 'qr', qr: 'QRDATA' });
    expect(wa.status.state).toBe('qr');
    expect(wa.status.qr).toBe('QRDATA');
    expect(states).toHaveLength(1);
  });

  it('logout sets logged_out and takeover reopens', async () => {
    const wa = new FakeWaAdapter();
    await wa.connect();
    wa.simulateStatus({ state: 'replaced' });
    await wa.takeover();
    expect(wa.status.state).toBe('open');
    await wa.logout();
    expect(wa.status.state).toBe('logged_out');
    expect(wa.status.me).toBeNull();
  });
});

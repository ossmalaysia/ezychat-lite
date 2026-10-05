import { EventEmitter } from 'node:events';
import type { WaStatus } from '@wa-team-inbox/shared';
import {
  WaUnavailableError,
  type SendResult,
  type WaAdapter,
  type WaAdapterEvents,
  type WaContactAlias,
  type WaIncomingMessage,
  type WaSendFile,
} from '../types.js';

const FAKE_ME = { jid: '60000000000@s.whatsapp.net', name: 'Fake' } as const;

export interface FakeSentRecord {
  chatJid: string;
  text?: string;
  file?: WaSendFile;
  id: string;
}

/**
 * In-memory WaAdapter for tests and `--fake-wa` dev mode. Never touches the network.
 */
export class FakeWaAdapter extends EventEmitter implements WaAdapter {
  private _status: WaStatus = { state: 'disconnected', me: null, qr: null, lastError: null };
  private readonly autoOpen: boolean;
  private inCounter = 0;
  private outCounter = 0;
  private nextSendError: Error | null = null;
  private readonly media = new Map<string, Buffer>();

  readonly sent: FakeSentRecord[] = [];
  readonly reads: Array<{ chatJid: string; messageIds: string[] }> = [];
  readonly presences: Array<{ chatJid: string; presence: 'composing' | 'paused' }> = [];

  constructor(opts?: { autoOpen?: boolean }) {
    super();
    this.autoOpen = opts?.autoOpen ?? true;
  }

  get status(): WaStatus {
    return this._status;
  }

  override on<K extends keyof WaAdapterEvents>(
    ev: K,
    fn: (...a: WaAdapterEvents[K]) => void,
  ): this {
    return super.on(ev, fn as (...a: unknown[]) => void);
  }

  override off<K extends keyof WaAdapterEvents>(
    ev: K,
    fn: (...a: WaAdapterEvents[K]) => void,
  ): this {
    return super.off(ev, fn as (...a: unknown[]) => void);
  }

  private emitTyped<K extends keyof WaAdapterEvents>(ev: K, ...args: WaAdapterEvents[K]): void {
    this.emit(ev, ...args);
  }

  private setStatus(patch: Partial<WaStatus>): void {
    this._status = { ...this._status, ...patch };
    this.emitTyped('status', this._status);
  }

  async connect(): Promise<void> {
    if (this._status.state === 'open' || this._status.state === 'connecting') return;
    this.setStatus({ state: 'connecting', qr: null, lastError: null });
    if (this.autoOpen) this.setStatus({ state: 'open', me: { ...FAKE_ME }, qr: null });
  }

  async disconnect(): Promise<void> {
    if (this._status.state === 'disconnected') return;
    this.setStatus({ state: 'disconnected', qr: null });
  }

  async logout(): Promise<void> {
    this.setStatus({ state: 'logged_out', me: null, qr: null });
  }

  async takeover(): Promise<void> {
    this.setStatus({ state: 'connecting', qr: null, lastError: null });
    this.setStatus({ state: 'open', me: { ...FAKE_ME }, qr: null });
  }

  /** test helper: last phone number a pairing code was requested for */
  pairingRequests: string[] = [];

  async requestPairingCode(phone: string): Promise<string> {
    if (this._status.state === 'open') throw new Error('A WhatsApp number is already linked');
    this.pairingRequests.push(phone.replace(/\D/g, ''));
    return 'FAKE1234';
  }

  private beforeSend(): void {
    if (this._status.state !== 'open') throw new WaUnavailableError();
    if (this.nextSendError) {
      const err = this.nextSendError;
      this.nextSendError = null;
      throw err;
    }
  }

  private afterSend(chatJid: string, id: string): SendResult {
    const timestamp = Date.now();
    this.emitTyped('messageStatus', { id, chatJid, status: 'sent' });
    setImmediate(() => this.emitTyped('messageStatus', { id, chatJid, status: 'delivered' }));
    return { id, timestamp };
  }

  async sendText(
    chatJid: string,
    text: string,
    _opts?: { quotedId?: string },
  ): Promise<SendResult> {
    this.beforeSend();
    const id = `FAKE-OUT-${++this.outCounter}`;
    this.sent.push({ chatJid, text, id });
    return this.afterSend(chatJid, id);
  }

  async sendMedia(
    chatJid: string,
    file: WaSendFile,
    _opts?: { quotedId?: string },
  ): Promise<SendResult> {
    this.beforeSend();
    const id = `FAKE-OUT-${++this.outCounter}`;
    this.sent.push({ chatJid, file, id });
    this.media.set(id, file.buffer);
    return this.afterSend(chatJid, id);
  }

  async markRead(chatJid: string, messageIds: string[]): Promise<void> {
    this.reads.push({ chatJid, messageIds: [...messageIds] });
  }

  async sendPresence(chatJid: string, presence: 'composing' | 'paused'): Promise<void> {
    this.presences.push({ chatJid, presence });
  }

  async downloadMedia(messageId: string): Promise<Buffer | null> {
    return this.media.get(messageId) ?? null;
  }

  async getProfilePicture(_jid: string): Promise<string | null> {
    return null;
  }

  async getContactAliases(_jids: string[]): Promise<WaContactAlias[]> {
    return [];
  }

  // ---- test helpers ----

  /** makes downloadMedia(messageId) return `buffer` */
  setMedia(messageId: string, buffer: Buffer): void {
    this.media.set(messageId, buffer);
  }

  /** Emit explicit PN/LID pairs as the adapter does when WhatsApp reveals them. */
  simulateContactAliases(pairs: WaContactAlias[]): void {
    this.emitTyped(
      'contactAliases',
      pairs.map((p) => ({ ...p })),
    );
  }

  /** Emit an incoming live message. Generates id `FAKE-<n>` unless given. */
  simulateIncoming(
    p: Partial<WaIncomingMessage> & { chatJid: string; body: string },
  ): WaIncomingMessage {
    const id = p.id ?? `FAKE-${++this.inCounter}`;
    const isGroup = p.chatJid.endsWith('@g.us');
    const msg: WaIncomingMessage = {
      id,
      chatJid: p.chatJid,
      chatJidAlt: p.chatJidAlt ?? null,
      senderJid: p.senderJid !== undefined ? p.senderJid : isGroup ? null : p.chatJid,
      senderName: p.senderName ?? null,
      fromMe: p.fromMe ?? false,
      type: p.type ?? 'text',
      body: p.body,
      quotedId: p.quotedId ?? null,
      timestamp: p.timestamp ?? Date.now(),
      media: p.media ?? null,
    };
    this.emitTyped('message', msg, { source: 'live' });
    return msg;
  }

  simulateStatus(s: Partial<WaStatus>): void {
    this.setStatus(s);
  }

  failNextSend(err: Error = new Error('Fake send failure')): void {
    this.nextSendError = err;
  }

  setConnected(connected: boolean): void {
    if (connected) this.setStatus({ state: 'open', me: { ...FAKE_ME }, qr: null, lastError: null });
    else this.setStatus({ state: 'disconnected', qr: null });
  }
}

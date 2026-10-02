import { EventEmitter } from 'node:events';
import {
  Browsers,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
  type AnyMessageContent,
  type BaileysEventMap,
  type Chat,
  type Contact,
  type GroupMetadata,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from 'baileys';
import { pino, type Logger } from 'pino';
import type { WaStatus } from '@wa-team-inbox/shared';
import {
  WaUnavailableError,
  type SendResult,
  type WaAdapter,
  type WaAdapterEvents,
  type WaAdapterOptions,
  type WaChatInfo,
  type WaContactInfo,
  type WaMessageStatusUpdate,
  type WaSendFile,
} from '../types.js';
import { createAuthStore, type AuthStore } from './auth-store.js';
import { backoffMs, classifyDisconnect } from './disconnect.js';
import { Lru } from './lru.js';
import { jidType, mapWAMessage, toMs } from './mapping.js';

type ILogger = NonNullable<Parameters<typeof makeWASocket>[0]['logger']>;

const RAW_CACHE_MAX = 2000;
const DAY_MS = 86_400_000;

type BoomLike = { output?: { statusCode?: number }; message?: string };

/** proto.WebMessageInfo.Status → our status. */
function mapAck(status: number | null | undefined): WaMessageStatusUpdate['status'] | null {
  switch (status) {
    case proto.WebMessageInfo.Status.ERROR:
      return 'failed';
    case proto.WebMessageInfo.Status.SERVER_ACK:
      return 'sent';
    case proto.WebMessageInfo.Status.DELIVERY_ACK:
      return 'delivered';
    case proto.WebMessageInfo.Status.READ:
    case proto.WebMessageInfo.Status.PLAYED:
      return 'read';
    default:
      return null;
  }
}

/**
 * Real WhatsApp connection via Baileys (WhatsApp Web multi-device protocol).
 * This is the only module in the repo allowed to import `baileys`.
 */
export class BaileysAdapter extends EventEmitter implements WaAdapter {
  private _status: WaStatus = { state: 'disconnected', me: null, qr: null, lastError: null };
  private sock: WASocket | null = null;
  private readonly auth: AuthStore;
  private readonly logger: Logger;
  private readonly historyDays: number;
  private readonly raw = new Lru<string, WAMessage>(RAW_CACHE_MAX);
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** true when the socket was closed on purpose (disconnect/logout/replaced/blocked). */
  private stopped = true;
  private connecting: Promise<void> | null = null;

  constructor(opts: WaAdapterOptions) {
    super();
    this.auth = createAuthStore(opts.authDir);
    this.historyDays = opts.historyDays;
    this.logger = opts.logger ?? pino({ level: 'silent' });
  }

  get status(): WaStatus {
    return this._status;
  }

  override on<K extends keyof WaAdapterEvents>(ev: K, fn: (...a: WaAdapterEvents[K]) => void): this {
    return super.on(ev, fn as (...a: unknown[]) => void);
  }

  override off<K extends keyof WaAdapterEvents>(ev: K, fn: (...a: WaAdapterEvents[K]) => void): this {
    return super.off(ev, fn as (...a: unknown[]) => void);
  }

  private emitTyped<K extends keyof WaAdapterEvents>(ev: K, ...args: WaAdapterEvents[K]): void {
    try {
      this.emit(ev, ...args);
    } catch (err) {
      this.logger.error({ err, ev }, 'wa listener threw');
    }
  }

  private setStatus(patch: Partial<WaStatus>): void {
    this._status = { ...this._status, ...patch };
    this.emitTyped('status', this._status);
  }

  // ---------------------------------------------------------------- lifecycle

  async connect(): Promise<void> {
    this.stopped = false;
    if (this.sock || this.connecting) return this.connecting ?? undefined;
    this.clearReconnect();
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearReconnect();
    await this.closeSocket();
    this.setStatus({ state: 'disconnected', qr: null });
  }

  async logout(): Promise<void> {
    this.stopped = true;
    this.clearReconnect();
    const sock = this.sock;
    if (sock) {
      try {
        await sock.logout();
      } catch (err) {
        this.logger.warn({ err }, 'wa logout request failed; wiping auth anyway');
      }
    }
    await this.closeSocket();
    await this.auth.wipe();
    this.setStatus({ state: 'logged_out', me: null, qr: null });
  }

  async takeover(): Promise<void> {
    this.attempt = 0;
    await this.closeSocket();
    await this.connect();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async closeSocket(): Promise<void> {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    sock.ev.removeAllListeners('connection.update');
    try {
      await sock.end(undefined);
    } catch {
      /* already closed */
    }
  }

  private scheduleReconnect(immediate = false): void {
    if (this.stopped) return;
    this.clearReconnect();
    const delay = immediate ? 0 : backoffMs(this.attempt++);
    this.logger.info({ delay, attempt: this.attempt }, 'wa reconnect scheduled');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.logger.error({ err }, 'wa reconnect failed');
        this.setStatus({ state: 'disconnected', lastError: String((err as Error)?.message ?? err) });
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async open(): Promise<void> {
    this.setStatus({ state: 'connecting', qr: null });
    const { state, saveCreds } = await this.auth.load();

    let version: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch (err) {
      this.logger.warn({ err }, 'could not fetch latest WA version; using bundled default');
    }

    if (this.stopped) return; // disconnect() was called while loading

    const blog = this.logger.child({ module: 'baileys' }) as unknown as ILogger;
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, blog) },
      logger: blog,
      browser: Browsers.appropriate('Desktop'),
      syncFullHistory: this.historyDays > 0,
      markOnlineOnConnect: false,
      // Per-message filtering by historyDays happens in onHistory/ingest.
      shouldSyncHistoryMessage: () => this.historyDays > 0,
      getMessage: async (key) => (key.id ? this.raw.get(key.id)?.message ?? undefined : undefined),
    });
    this.sock = sock;

    const alive = () => this.sock === sock;

    sock.ev.on('creds.update', () => {
      saveCreds().catch((err) => this.logger.error({ err }, 'saveCreds failed'));
    });

    sock.ev.on('connection.update', (u) => {
      if (!alive()) return;
      this.onConnectionUpdate(sock, u);
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (!alive()) return;
      const source = type === 'notify' ? 'live' : 'history';
      for (const m of messages) this.ingest(m, source);
    });

    sock.ev.on('messaging-history.set', (h) => {
      if (!alive()) return;
      this.onHistory(h);
    });

    sock.ev.on('messages.update', (updates) => {
      if (!alive()) return;
      for (const { key, update } of updates) {
        if (!key.id || !key.remoteJid || !key.fromMe) continue;
        const status = mapAck(update.status);
        if (status) this.emitTyped('messageStatus', { id: key.id, chatJid: key.remoteJid, status });
      }
    });

    sock.ev.on('contacts.upsert', (cs) => alive() && this.emitContacts(cs));
    sock.ev.on('contacts.update', (cs) => alive() && this.emitContacts(cs));
    sock.ev.on('chats.upsert', (cs) => alive() && this.emitChats(cs));
    sock.ev.on('groups.upsert', (gs) => alive() && this.emitGroups(gs));
    sock.ev.on('groups.update', (gs) => alive() && this.emitGroups(gs));
  }

  private onConnectionUpdate(sock: WASocket, u: BaileysEventMap['connection.update']): void {
    if (u.qr) {
      this.setStatus({ state: 'qr', qr: u.qr });
    }
    if (u.connection === 'connecting' && this._status.state !== 'qr') {
      this.setStatus({ state: 'connecting' });
    }
    if (u.connection === 'open') {
      this.attempt = 0;
      const user = sock.user;
      this.setStatus({
        state: 'open',
        qr: null,
        lastError: null,
        me: user ? { jid: jidNormalizedUser(user.id), name: user.name ?? user.notify ?? null } : null,
      });
    }
    if (u.connection === 'close') {
      const err = u.lastDisconnect?.error as BoomLike | undefined;
      const code = err?.output?.statusCode;
      const message = err?.message ?? (code ? `closed (${code})` : 'connection closed');
      this.sock = null;
      void this.handleClose(code, message);
    }
  }

  private async handleClose(code: number | undefined, message: string): Promise<void> {
    if (this.stopped) {
      this.setStatus({ state: 'disconnected', qr: null });
      return;
    }
    const action = classifyDisconnect(code);
    this.logger.warn({ code, action, message }, 'wa connection closed');
    switch (action) {
      case 'reconnect':
        this.setStatus({ state: 'connecting', lastError: message });
        // 515 restartRequired is expected right after pairing: reconnect at once.
        this.scheduleReconnect(code === 515);
        return;
      case 'logged_out':
        this.stopped = true;
        await this.auth.wipe().catch((e) => this.logger.error({ err: e }, 'auth wipe failed'));
        this.setStatus({ state: 'logged_out', me: null, qr: null, lastError: message });
        return;
      case 'replaced':
        this.stopped = true;
        this.setStatus({ state: 'replaced', qr: null, lastError: message });
        return;
      case 'bad_session':
        try {
          const bak = await this.auth.backup();
          this.logger.warn({ bak }, 'bad session: auth backed up, wiping to request relink');
          await this.auth.wipe();
        } catch (e) {
          this.logger.error({ err: e }, 'bad session backup/wipe failed');
        }
        this.setStatus({ state: 'connecting', me: null, qr: null, lastError: message });
        this.scheduleReconnect(true);
        return;
      case 'blocked':
        this.stopped = true;
        this.setStatus({ state: 'blocked', qr: null, lastError: message });
        return;
    }
  }

  // ---------------------------------------------------------------- inbound

  private historyCutoff(): number {
    return this.historyDays > 0 ? Date.now() - this.historyDays * DAY_MS : Number.POSITIVE_INFINITY;
  }

  private ingest(m: WAMessage, source: 'live' | 'history'): void {
    const id = m.key?.id;
    if (!id) return;
    if (m.message) this.raw.set(id, m);
    const mapped = mapWAMessage(m, (raw) => this.download(raw));
    if (!mapped) return;
    if (source === 'history' && mapped.timestamp < this.historyCutoff()) return;
    this.emitTyped('message', mapped, { source });
  }

  private onHistory(h: BaileysEventMap['messaging-history.set']): void {
    if (h.contacts?.length) this.emitContacts(h.contacts);
    if (h.chats?.length) this.emitChats(h.chats);
    const cutoff = this.historyCutoff();
    for (const m of h.messages ?? []) {
      if (toMs(m.messageTimestamp as number | null | undefined, 0) < cutoff) continue;
      this.ingest(m, 'history');
    }
  }

  private emitContacts(cs: Array<Partial<Contact>>): void {
    const out: WaContactInfo[] = [];
    for (const c of cs) {
      if (!c.id || jidType(c.id) !== 'dm') continue;
      out.push({ jid: c.id, pushName: c.notify ?? c.verifiedName ?? null, savedName: c.name ?? null });
    }
    if (out.length) this.emitTyped('contacts', out);
  }

  private emitChats(cs: Array<Partial<Chat>>): void {
    const out: WaChatInfo[] = [];
    for (const c of cs) {
      if (!c.id) continue;
      const t = jidType(c.id);
      if (t === 'other') continue;
      out.push({ jid: c.id, type: t, name: c.name ?? null });
    }
    if (out.length) this.emitTyped('chats', out);
  }

  private emitGroups(gs: Array<Partial<GroupMetadata>>): void {
    const out: WaChatInfo[] = [];
    for (const g of gs) {
      if (!g.id || jidType(g.id) !== 'group') continue;
      out.push({ jid: g.id, type: 'group', name: g.subject ?? null });
    }
    if (out.length) this.emitTyped('chats', out);
  }

  private async download(raw: WAMessage): Promise<Buffer> {
    const sock = this.sock;
    const buf = await downloadMediaMessage(
      raw,
      'buffer',
      {},
      sock
        ? { reuploadRequest: sock.updateMediaMessage, logger: this.logger as unknown as ILogger }
        : undefined,
    );
    return buf as Buffer;
  }

  // ---------------------------------------------------------------- outbound

  private requireOpen(): WASocket {
    if (!this.sock || this._status.state !== 'open') throw new WaUnavailableError();
    return this.sock;
  }

  private async send(chatJid: string, content: AnyMessageContent, quotedId?: string): Promise<SendResult> {
    const sock = this.requireOpen();
    const quoted = quotedId ? this.raw.get(quotedId) : undefined;
    const res = await sock.sendMessage(chatJid, content, quoted ? { quoted } : undefined);
    const id = res?.key?.id;
    if (!res || !id) throw new Error('send returned no message id');
    this.raw.set(id, res);
    return { id, timestamp: toMs(res.messageTimestamp as number | null | undefined) };
  }

  sendText(chatJid: string, text: string, opts?: { quotedId?: string }): Promise<SendResult> {
    return this.send(chatJid, { text }, opts?.quotedId);
  }

  sendMedia(chatJid: string, file: WaSendFile, opts?: { quotedId?: string }): Promise<SendResult> {
    const { buffer, mime, fileName, caption } = file;
    let content: AnyMessageContent;
    if (mime.startsWith('image/') && mime !== 'image/webp') {
      content = { image: buffer, mimetype: mime, ...(caption ? { caption } : {}) };
    } else if (mime === 'image/webp') {
      content = { sticker: buffer, mimetype: mime };
    } else if (mime.startsWith('video/')) {
      content = { video: buffer, mimetype: mime, ...(caption ? { caption } : {}) };
    } else if (mime.startsWith('audio/')) {
      content = { audio: buffer, mimetype: mime };
    } else {
      content = { document: buffer, mimetype: mime, fileName, ...(caption ? { caption } : {}) };
    }
    return this.send(chatJid, content, opts?.quotedId);
  }

  async markRead(chatJid: string, messageIds: string[]): Promise<void> {
    const sock = this.requireOpen();
    const keys: WAMessageKey[] = messageIds.map((id) => {
      const raw = this.raw.get(id);
      return raw?.key
        ? { remoteJid: chatJid, id, fromMe: false, participant: raw.key.participant ?? undefined }
        : { remoteJid: chatJid, id, fromMe: false };
    });
    if (keys.length) await sock.readMessages(keys);
  }

  async sendPresence(chatJid: string, presence: 'composing' | 'paused'): Promise<void> {
    const sock = this.requireOpen();
    await sock.sendPresenceUpdate(presence, chatJid);
  }

  async downloadMedia(messageId: string): Promise<Buffer | null> {
    const raw = this.raw.get(messageId);
    if (!raw) return null;
    try {
      return await this.download(raw);
    } catch (err) {
      this.logger.warn({ err, messageId }, 'media download failed');
      return null;
    }
  }

  async getProfilePicture(jid: string): Promise<string | null> {
    if (!this.sock || this._status.state !== 'open') return null;
    try {
      return (await this.sock.profilePictureUrl(jid, 'preview')) ?? null;
    } catch {
      return null;
    }
  }
}

import type { Logger } from 'pino';
import type { MessageType, WaStatus } from '@wa-team-inbox/shared';

export interface WaIncomingMessage {
  id: string;
  chatJid: string;
  senderJid: string | null;
  senderName: string | null;
  fromMe: boolean;
  type: MessageType;
  body: string | null;
  quotedId: string | null;
  /** epoch ms */
  timestamp: number;
  media: null | { mime: string; fileName: string | null; download: () => Promise<Buffer> };
}

export interface WaChatInfo {
  jid: string;
  type: 'dm' | 'group';
  name: string | null;
}

export interface WaContactInfo {
  jid: string;
  pushName: string | null;
  savedName: string | null;
}

export interface WaMessageStatusUpdate {
  id: string;
  chatJid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface WaAdapterEvents {
  status: [WaStatus];
  message: [WaIncomingMessage, { source: 'live' | 'history' }];
  messageStatus: [WaMessageStatusUpdate];
  chats: [WaChatInfo[]];
  contacts: [WaContactInfo[]];
}

export interface SendResult {
  id: string;
  timestamp: number;
}

export interface WaSendFile {
  buffer: Buffer;
  mime: string;
  fileName: string;
  caption?: string;
}

export interface WaAdapter {
  readonly status: WaStatus;
  on<K extends keyof WaAdapterEvents>(ev: K, fn: (...a: WaAdapterEvents[K]) => void): this;
  off<K extends keyof WaAdapterEvents>(ev: K, fn: (...a: WaAdapterEvents[K]) => void): this;
  /** idempotent */
  connect(): Promise<void>;
  /** close socket, keep auth */
  disconnect(): Promise<void>;
  /** unlink device + wipe auth */
  logout(): Promise<void>;
  /** reconnect after 'replaced' */
  takeover(): Promise<void>;
  sendText(chatJid: string, text: string, opts?: { quotedId?: string }): Promise<SendResult>;
  sendMedia(chatJid: string, file: WaSendFile, opts?: { quotedId?: string }): Promise<SendResult>;
  markRead(chatJid: string, messageIds: string[]): Promise<void>;
  sendPresence(chatJid: string, presence: 'composing' | 'paused'): Promise<void>;
  /** re-download by id if still cached */
  downloadMedia(messageId: string): Promise<Buffer | null>;
  /** URL */
  getProfilePicture(jid: string): Promise<string | null>;
}

export interface WaAdapterOptions {
  authDir: string;
  historyDays: number;
  logger?: Logger;
}

export class WaUnavailableError extends Error {
  readonly code = 'wa_unavailable' as const;
  constructor(message = 'WhatsApp is not connected') {
    super(message);
    this.name = 'WaUnavailableError';
  }
}

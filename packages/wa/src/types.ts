import type { Logger } from 'pino';
import type { MessageType, WaStatus } from '@wa-team-inbox/shared';

export interface WaIncomingMessage {
  id: string;
  chatJid: string;
  /**
   * DM only: the same person's other address as WhatsApp delivered it (`key.remoteJidAlt`), PN for a
   * LID chat or the reverse, device suffix stripped. Null/absent for groups or when not provided.
   */
  chatJidAlt?: string | null;
  senderJid: string | null;
  senderName: string | null;
  fromMe: boolean;
  type: MessageType;
  body: string | null;
  quotedId: string | null;
  /** epoch ms */
  timestamp: number;
  media: null | { mime: string; fileName: string | null; download: () => Promise<Buffer> };
  /** audio only: WhatsApp reported push-to-talk (`audioMessage.ptt`), i.e. a voice note */
  voice?: boolean;
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
  /** Explicitly associated phone/LID identities, never inferred from names. */
  aliases?: string[];
}

/** Where an explicit PN/LID association was learned (stored in jid_aliases.source). */
export type WaAliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore';

export interface WaContactAlias {
  jid: string;
  alias: string;
  source?: WaAliasSource;
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
  contactAliases: [WaContactAlias[]];
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
  /**
   * Send as a WhatsApp voice note (push-to-talk): `buffer` must be OGG/Opus and `mime`
   * `audio/ogg; codecs=opus`. `seconds` is the playback length shown on the phone.
   */
  voice?: { seconds: number };
}

/** Chat presence shown to the customer: typing, recording audio, or neither. */
export type WaPresence = 'composing' | 'recording' | 'paused';

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
  /** link by phone number: returns the 8-character pairing code to enter on the phone */
  requestPairingCode(phone: string): Promise<string>;
  sendText(chatJid: string, text: string, opts?: { quotedId?: string }): Promise<SendResult>;
  sendMedia(chatJid: string, file: WaSendFile, opts?: { quotedId?: string }): Promise<SendResult>;
  markRead(chatJid: string, messageIds: string[]): Promise<void>;
  sendPresence(chatJid: string, presence: WaPresence): Promise<void>;
  /** re-download by id if still cached */
  downloadMedia(messageId: string): Promise<Buffer | null>;
  /** URL */
  getProfilePicture(jid: string): Promise<string | null>;
  /** Resolve existing local phone/LID mappings only; must not query WhatsApp. */
  getContactAliases(jids: string[]): Promise<WaContactAlias[]>;
}

export interface WaAdapterOptions {
  authDir: string;
  /** days of history to import; a getter is re-read on every (re)connect / history batch */
  historyDays: number | (() => number);
  logger?: Logger;
}

export class WaUnavailableError extends Error {
  readonly code = 'wa_unavailable' as const;
  constructor(message = 'WhatsApp is not connected') {
    super(message);
    this.name = 'WaUnavailableError';
  }
}

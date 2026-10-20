import type { Logger } from 'pino';
import type { MessageType, WaStatus } from '@ezychat/shared';

export interface WaIncomingMessage {
  id: string;
  chatJid: string;
  /**
   * DM only: the same person's other address as WhatsApp delivered it (`key.remoteJidAlt`), PN for a
   * LID chat or the reverse, device suffix stripped. Null/absent for groups or when not provided.
   */
  chatJidAlt?: string | null;
  senderJid: string | null;
  /** Group sender's explicitly associated alternate phone/LID address. */
  senderJidAlt?: string | null;
  senderName: string | null;
  fromMe: boolean;
  type: MessageType;
  body: string | null;
  /** Explicit mentions from contextInfo; absent only for older adapters/imports. */
  mentionedJids?: string[];
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

/** A member of a WhatsApp group, as WhatsApp lists it (names are not part of the list). */
export interface WaGroupParticipant {
  /** The member's address as the group lists it: a phone-number JID or a WhatsApp ID (LID). */
  jid: string;
  /** Phone-number JID when WhatsApp shares it (`…@s.whatsapp.net`), else null (number hidden). */
  phoneJid: string | null;
  /** WhatsApp ID (`…@lid`) when known, else null. */
  lidJid: string | null;
  /** WhatsApp username, only when WhatsApp sends it. */
  username: string | null;
  role: 'superadmin' | 'admin' | 'member';
}

export interface WaGroupInfo {
  jid: string;
  name: string | null;
  description: string | null;
  /** epoch ms, null when unknown */
  createdAt: number | null;
  /** Creator's phone-number JID or WhatsApp ID, when known. */
  ownerJid: string | null;
  /** Member count reported by WhatsApp (can exceed participants.length for very large groups). */
  size: number;
  participants: WaGroupParticipant[];
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
  /** A group's members or settings changed; cached member lists for it are stale. */
  groupChanged: [{ groupJid: string }];
}

/**
 * Saved copy of a quoted message (from the database). The adapter's live message cache is small and
 * cleared on reconnect, so a reply to an older message rebuilds the quote from this instead.
 */
export interface WaQuotedRef {
  id: string;
  fromMe: boolean;
  /** Group messages: who wrote it (needed so WhatsApp attributes the quote). */
  senderJid: string | null;
  type: MessageType;
  /** Text or caption; null for media without a caption. */
  text: string | null;
}

export interface WaSendOptions {
  /** Reply to this WhatsApp message id. */
  quotedId?: string;
  /** Used when the quoted message is no longer in the adapter's live cache. */
  quoted?: WaQuotedRef;
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
  /** Send OGG/Opus audio as a voice note (push-to-talk), with its length and 64-bar waveform (0–100). */
  voiceNote?: { seconds: number; waveform: Uint8Array };
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
  /** link by phone number: returns the 8-character pairing code to enter on the phone */
  requestPairingCode(phone: string): Promise<string>;
  sendText(chatJid: string, text: string, opts?: WaSendOptions): Promise<SendResult>;
  sendMedia(chatJid: string, file: WaSendFile, opts?: WaSendOptions): Promise<SendResult>;
  markRead(chatJid: string, messageIds: string[]): Promise<void>;
  sendPresence(chatJid: string, presence: 'composing' | 'paused'): Promise<void>;
  /** re-download by id if still cached */
  downloadMedia(messageId: string): Promise<Buffer | null>;
  /** Photo URL; null when there is none or it is private. Throws when it cannot be read. */
  getProfilePicture(jid: string): Promise<string | null>;
  /** Members and details of a group this number belongs to. Throws WaUnavailableError when offline. */
  getGroupInfo(groupJid: string): Promise<WaGroupInfo>;
  /** A person's WhatsApp "About" text; null when hidden or unset. Throws when it cannot be read. */
  getAbout(jid: string): Promise<string | null>;
  /**
   * Ask WhatsApp whether a phone number (digits with country code, no `+`) has an account: its phone
   * JID, or null when it has none. Throws WaUnavailableError when offline.
   */
  checkNumber(phone: string): Promise<string | null>;
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

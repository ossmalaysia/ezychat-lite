import { z } from 'zod';
import {
  ChatEventType,
  ChatStatus,
  ChatType,
  MediaStatus,
  MessageStatus,
  MessageType,
  Role,
  TunnelMode,
  TranscriptStatus,
  TunnelState,
  WaState,
} from './enums.js';
import { LocaleSchema } from './i18n/locales.js';

// All timestamps are epoch milliseconds.

export const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
  displayName: z.string(),
  role: Role,
  /** Omitted by older clients/fixtures; persisted users always have an explicit kind. */
  kind: z.enum(['human', 'ai']).optional(),
  /** Business role, independent of sign-in permissions. The first AI member handles sales. */
  aiRole: z.literal('sales').optional(),
  mustChangePassword: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.number(),
  /** Preferred UI language; null = follow the browser. */
  locale: LocaleSchema.nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const ChatSchema = z.object({
  jid: z.string(),
  type: ChatType,
  name: z.string(),
  /** Authenticated image endpoint; missing/private WhatsApp photos fall back to initials. */
  avatarUrl: z.string().nullable(),
  unreadCount: z.number(),
  lastMessageAt: z.number().nullable(),
  lastMessagePreview: z.string().nullable(),
  status: ChatStatus,
  assignedTo: z.number().nullable(),
  updatedAt: z.number(),
  /** Phone-number digits without `+`; null when WhatsApp has only revealed the WhatsApp ID (LID). */
  phone: z.string().nullable(),
});
export type Chat = z.infer<typeof ChatSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  chatJid: z.string(),
  senderJid: z.string().nullable(),
  senderName: z.string().nullable(),
  fromMe: z.boolean(),
  sentByUserId: z.number().nullable(),
  type: MessageType,
  body: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  mediaMime: z.string().nullable(),
  mediaName: z.string().nullable(),
  mediaStatus: MediaStatus,
  quotedId: z.string().nullable(),
  status: MessageStatus,
  error: z.string().nullable(),
  timestamp: z.number(),
  clientId: z.string().nullable(),
  /** Voice notes only (inbound audio): the transcript text, when `transcriptStatus` is `ok`. */
  transcript: z.string().nullable().optional(),
  /** Language the transcriber detected (e.g. `en`, `ms`, `zh`), when known. */
  transcriptLang: z.string().nullable().optional(),
  /** Missing/null = never transcribed (feature off, history, outbound). */
  transcriptStatus: TranscriptStatus.nullable().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const NoteSchema = z.object({
  id: z.number(),
  chatJid: z.string(),
  userId: z.number(),
  body: z.string(),
  createdAt: z.number(),
});
export type Note = z.infer<typeof NoteSchema>;

export const ChatEventSchema = z.object({
  id: z.number(),
  chatJid: z.string(),
  type: ChatEventType,
  actorId: z.number().nullable(),
  payload: z.record(z.string(), z.unknown()),
  at: z.number(),
});
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const QuickReplySchema = z.object({
  id: z.number(),
  shortcut: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  body: z.string().min(1).max(4096),
  updatedAt: z.number(),
});
export type QuickReply = z.infer<typeof QuickReplySchema>;

export const WaStatusSchema = z.object({
  state: WaState,
  me: z.object({ jid: z.string(), name: z.string().nullable() }).nullable(),
  qr: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type WaStatus = z.infer<typeof WaStatusSchema>;

export const TunnelStatusSchema = z.object({
  mode: TunnelMode,
  state: TunnelState,
  url: z.string().nullable(),
  hostname: z.string().nullable(),
  lastError: z.string().nullable(),
  logTail: z.array(z.string()),
});
export type TunnelStatus = z.infer<typeof TunnelStatusSchema>;

export const SettingsSchema = z.object({
  port: z.number().int().min(1024).max(65535),
  lanEnabled: z.boolean(),
  historyDays: z.number().int().min(0).max(365),
  namedTunnelHostname: z.string().nullable(),
  hasTunnelToken: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const AuditEntrySchema = z.object({
  id: z.number(),
  userId: z.number().nullable(),
  action: z.string(),
  ip: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  at: z.number(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

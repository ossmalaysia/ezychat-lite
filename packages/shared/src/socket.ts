import type { MessageStatus } from './enums.js';
import { z } from 'zod';
import type { Chat, ChatEvent, Message, Note, TunnelStatus, WaStatus } from './models.js';
import type { InboxStatusPayload } from './inboxes.js';
import type { VoiceStatus } from './voice.js';

export interface MessageStatusPayload {
  id: string;
  clientId: string | null;
  chatJid: string;
  status: MessageStatus;
  error: string | null;
  newId?: string;
}

export interface TypingPayload {
  chatJid: string;
  userId: number;
  displayName: string;
}

/** Authenticated, recipient-targeted notification for connected desktop clients. */
export const NotificationPayload = z.object({
  title: z.string().max(200),
  body: z.string().max(1000),
  url: z.string().max(1024),
  tag: z.string().max(256),
});
export type NotificationPayload = z.infer<typeof NotificationPayload>;

export interface ServerToClientEvents {
  'notification:new': (notification: NotificationPayload) => void;
  'message:new': (m: Message) => void;
  'message:status': (p: MessageStatusPayload) => void;
  /** An existing message changed (e.g. its voice note transcript arrived). */
  'message:updated': (m: Message) => void;
  /** Voice model download/install state (admins only). */
  'voice:status': (s: VoiceStatus) => void;
  'chat:updated': (c: Chat) => void;
  'chat:event': (e: ChatEvent) => void;
  'note:new': (n: Note) => void;
  typing: (p: TypingPayload) => void;
  /** Connection status of inbox 1 (the number linked before multi-inbox). */
  'wa:status': (s: WaStatus) => void;
  /** Connection status of one inbox, sent only to users who may open it. */
  'inbox:status': (p: InboxStatusPayload) => void;
  /** An inbox was added, renamed or removed, or its members changed: reload the inbox list. */
  'inboxes:changed': () => void;
  'tunnel:status': (s: TunnelStatus) => void;
  'session:revoked': () => void;
  /** The access gate closed (an edition turned the app off); the socket is disconnected next. */
  'access:closed': (p: { code: string }) => void;
}

export interface ClientToServerEvents {
  typing: (p: { chatJid: string }) => void;
}

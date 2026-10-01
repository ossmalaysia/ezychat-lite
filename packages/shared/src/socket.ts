import type { MessageStatus } from './enums.js';
import type { Chat, ChatEvent, Message, Note, TunnelStatus, WaStatus } from './models.js';

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

export interface ServerToClientEvents {
  'message:new': (m: Message) => void;
  'message:status': (p: MessageStatusPayload) => void;
  'chat:updated': (c: Chat) => void;
  'chat:event': (e: ChatEvent) => void;
  'note:new': (n: Note) => void;
  typing: (p: TypingPayload) => void;
  'wa:status': (s: WaStatus) => void;
  'tunnel:status': (s: TunnelStatus) => void;
  'session:revoked': () => void;
}

export interface ClientToServerEvents {
  typing: (p: { chatJid: string }) => void;
}

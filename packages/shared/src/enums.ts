import { z } from 'zod';

export const Role = z.enum(['admin', 'agent']);
export type Role = z.infer<typeof Role>;

export const ChatType = z.enum(['dm', 'group']);
export type ChatType = z.infer<typeof ChatType>;

export const ChatStatus = z.enum(['open', 'resolved']);
export type ChatStatus = z.infer<typeof ChatStatus>;

export const MessageType = z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'system']);
export type MessageType = z.infer<typeof MessageType>;

export const MessageStatus = z.enum(['pending', 'sent', 'delivered', 'read', 'failed']);
export type MessageStatus = z.infer<typeof MessageStatus>;

export const MediaStatus = z.enum(['none', 'ok', 'failed', 'pending']);
export type MediaStatus = z.infer<typeof MediaStatus>;

export const WaState = z.enum(['disconnected', 'connecting', 'qr', 'open', 'logged_out', 'replaced', 'blocked']);
export type WaState = z.infer<typeof WaState>;

export const TunnelMode = z.enum(['off', 'quick', 'named']);
export type TunnelMode = z.infer<typeof TunnelMode>;

export const TunnelState = z.enum(['stopped', 'starting', 'running', 'error']);
export type TunnelState = z.infer<typeof TunnelState>;

export const ChatEventType = z.enum(['assigned', 'unassigned', 'resolved', 'reopened']);
export type ChatEventType = z.infer<typeof ChatEventType>;

import { z } from 'zod';
import { ChatStatus, MessageType, Role } from './enums.js';
import { LocaleSchema } from './i18n/locales.js';
import {
  ChatEventSchema,
  ChatSchema,
  MessageSchema,
  QuickReplySchema,
  SettingsSchema,
  UserSchema,
} from './models.js';

export const SetupStatusResponse = z.object({ needsSetup: z.boolean() });
export type SetupStatusResponse = z.infer<typeof SetupStatusResponse>;

export const SetupAdminBody = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
});
export type SetupAdminBody = z.infer<typeof SetupAdminBody>;

export const LoginBody = z.object({ username: z.string(), password: z.string() });
export type LoginBody = z.infer<typeof LoginBody>;

export const ChangePasswordBody = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(256),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

export const MeResponse = UserSchema;
export type MeResponse = z.infer<typeof MeResponse>;

/** Self-service preferences of the signed-in user. */
export const PatchMeBody = z.strictObject({ locale: LocaleSchema.nullable() });
export type PatchMeBody = z.infer<typeof PatchMeBody>;

export const ChatListQuery = z.object({
  status: ChatStatus.optional(),
  assigned: z.enum(['me', 'none', 'any']).default('any'),
  q: z.string().max(100).optional(),
  /** Customer tag filter, matched case-insensitively. */
  tag: z.string().trim().min(1).max(30).optional(),
  cursor: z.string().optional(),
  since: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ChatListQuery = z.infer<typeof ChatListQuery>;
/** Input shape (before defaults/coercion), for clients building query strings. */
export type ChatListQueryInput = z.input<typeof ChatListQuery>;

export const ChatListResponse = z.object({
  chats: z.array(ChatSchema),
  nextCursor: z.string().nullable(),
});
export type ChatListResponse = z.infer<typeof ChatListResponse>;

export const ChatPatchBody = z.object({
  assignedTo: z.number().nullable().optional(),
  status: ChatStatus.optional(),
});
export type ChatPatchBody = z.infer<typeof ChatPatchBody>;

export const OpenChatCountResponse = z.object({ openCount: z.number().int().nonnegative() });
export type OpenChatCountResponse = z.infer<typeof OpenChatCountResponse>;
export const ResolveAllChatsBody = z.object({ confirmed: z.literal(true) });
export type ResolveAllChatsBody = z.infer<typeof ResolveAllChatsBody>;
export const ResolveAllChatsResponse = z.object({ resolvedCount: z.number().int().nonnegative() });
export type ResolveAllChatsResponse = z.infer<typeof ResolveAllChatsResponse>;

export const ChatDetailResponse = z.object({ chat: ChatSchema, events: z.array(ChatEventSchema) });
export type ChatDetailResponse = z.infer<typeof ChatDetailResponse>;

export const MessageListQuery = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MessageListQuery = z.infer<typeof MessageListQuery>;
export type MessageListQueryInput = z.input<typeof MessageListQuery>;

export const MessageListResponse = z.object({
  messages: z.array(MessageSchema),
  nextBefore: z.string().nullable(),
});
export type MessageListResponse = z.infer<typeof MessageListResponse>;

export const SendTextBody = z.object({
  text: z.string().min(1).max(65536),
  quotedId: z.string().optional(),
  clientId: z.string().min(1).max(64),
});
export type SendTextBody = z.infer<typeof SendTextBody>;

export const NoteBody = z.object({ body: z.string().min(1).max(8192) });
export type NoteBody = z.infer<typeof NoteBody>;

export const QuickReplyBody = z.object({
  shortcut: QuickReplySchema.shape.shortcut,
  body: QuickReplySchema.shape.body,
});
export type QuickReplyBody = z.infer<typeof QuickReplyBody>;

export const CreateUserBody = z.object({
  username: SetupAdminBody.shape.username,
  displayName: SetupAdminBody.shape.displayName,
  role: Role,
  password: z.string().min(8).max(256),
});
export type CreateUserBody = z.infer<typeof CreateUserBody>;

export const PatchUserBody = z.object({
  displayName: z.string().min(1).max(64).optional(),
  role: Role.optional(),
  disabled: z.boolean().optional(),
});
export type PatchUserBody = z.infer<typeof PatchUserBody>;

export const ResetPasswordResponse = z.object({ password: z.string() });
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponse>;

/** Browser-side error report (written to the server log as a structured `mod: "web"` entry). */
export const ClientErrorBody = z.object({
  kind: z.enum(['error', 'unhandledrejection', 'react']),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  componentStack: z.string().max(8000).optional(),
  route: z.string().max(500),
  appVersion: z.string().max(50).optional(),
});
export type ClientErrorBody = z.infer<typeof ClientErrorBody>;

/** Link WhatsApp by phone number (pairing code) instead of QR. Phone includes country code. */
export const PairingCodeBody = z.object({ phone: z.string().min(8).max(32) });
export type PairingCodeBody = z.infer<typeof PairingCodeBody>;
export const PairingCodeResponse = z.object({ code: z.string() });
export type PairingCodeResponse = z.infer<typeof PairingCodeResponse>;

export const TunnelStartBody = z.object({
  mode: z.enum(['quick', 'named']),
  token: z.string().min(10).optional(),
  hostname: z.string().optional(),
});
export type TunnelStartBody = z.infer<typeof TunnelStartBody>;

/** Public setup state only. Cloudflare credentials never leave the server. */
export const CloudflareDomain = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/i),
  name: z.string(),
  accountName: z.string().nullable(),
});
export type CloudflareDomain = z.infer<typeof CloudflareDomain>;
export const CloudflareSetupStatus = z.object({
  state: z.enum(['signed_out', 'signing_in', 'awaiting_approval', 'connected', 'error']),
  loginUrl: z.string().nullable(),
  error: z.string().nullable(),
  domains: z.array(CloudflareDomain),
  busy: z.boolean(),
  managed: z.object({ id: z.string().uuid(), name: z.string(), hostname: z.string() }).nullable(),
});
export type CloudflareSetupStatus = z.infer<typeof CloudflareSetupStatus>;
export const CloudflareCreateBody = z.object({
  domainId: CloudflareDomain.shape.id,
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(63)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      'Use letters, numbers and hyphens, without a hyphen at either end.',
    ),
  tunnelName: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/,
      'Use letters, numbers, spaces, dots, underscores and hyphens.',
    ),
});
export type CloudflareCreateBody = z.infer<typeof CloudflareCreateBody>;

export const SettingsPatchBody = SettingsSchema.omit({ hasTunnelToken: true }).partial();
export type SettingsPatchBody = z.infer<typeof SettingsPatchBody>;

export const PushSubscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export type PushSubscribeBody = z.infer<typeof PushSubscribeBody>;

export const HealthResponse = z.object({
  app: z.literal('wa-team-inbox'),
  version: z.string(),
  mode: z.enum(['standalone', 'service', 'dev']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const FakeIncomingBody = z.object({
  chatJid: z.string(),
  /** fake WA only: the other address of the same person (PN for a LID chat, or the reverse) */
  chatJidAlt: z.string().max(256).optional(),
  text: z.string(),
  senderName: z.string().optional(),
  type: MessageType.optional(),
  /** fake WA only: attached media (e.g. a voice note), base64; served by the fake adapter's download. */
  media: z
    .object({
      mime: z.string().min(1).max(100),
      fileName: z.string().max(200).optional(),
      base64: z.string().min(1).max(1_000_000),
    })
    .optional(),
});
export type FakeIncomingBody = z.infer<typeof FakeIncomingBody>;

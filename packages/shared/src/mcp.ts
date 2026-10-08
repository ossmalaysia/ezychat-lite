import { z } from 'zod';
import { ChatStatus } from './enums.js';

// AI assistant (MCP) access: admin-created personal access tokens and the read-only tool inputs.

/** Days until a new token expires; null = never. */
export const ApiTokenExpiry = z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable();
export type ApiTokenExpiry = z.infer<typeof ApiTokenExpiry>;

export const ApiTokenSchema = z.object({
  id: z.number(),
  userId: z.number(),
  /** Display name of the admin who owns the token. */
  userName: z.string(),
  name: z.string(),
  /** First characters of the secret, enough to recognise it (never the whole secret). */
  prefix: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
});
export type ApiToken = z.infer<typeof ApiTokenSchema>;

export const CreateApiTokenBody = z.strictObject({
  name: z.string().trim().min(1).max(64),
  expiresInDays: ApiTokenExpiry.default(90),
});
export type CreateApiTokenBody = z.infer<typeof CreateApiTokenBody>;
export type CreateApiTokenBodyInput = z.input<typeof CreateApiTokenBody>;

/** The secret is returned only here, once. */
export const CreateApiTokenResponse = z.object({ token: ApiTokenSchema, secret: z.string() });
export type CreateApiTokenResponse = z.infer<typeof CreateApiTokenResponse>;

export const ApiTokenListResponse = z.object({ tokens: z.array(ApiTokenSchema) });
export type ApiTokenListResponse = z.infer<typeof ApiTokenListResponse>;

export const McpSettingsResponse = z.object({
  enabled: z.boolean(),
  /** Path of the MCP endpoint on this server (`/mcp`). */
  endpointPath: z.string(),
  /** Public HTTPS base URL of the running tunnel, null when no tunnel is up. */
  publicUrl: z.string().nullable(),
});
export type McpSettingsResponse = z.infer<typeof McpSettingsResponse>;

export const McpSettingsPatch = z.strictObject({ enabled: z.boolean() });
export type McpSettingsPatch = z.infer<typeof McpSettingsPatch>;

// Tool inputs. MCP clients send real JSON numbers, so these never coerce.

export const McpListChatsInput = z.strictObject({
  status: ChatStatus.optional().describe('open or resolved; omit for both'),
  assigned: z
    .enum(['any', 'none', 'me'])
    .default('any')
    .describe('any, none (unassigned) or me (the token owner)'),
  query: z.string().max(100).optional().describe('Match on customer name or phone number'),
  since: z.number().int().optional().describe('Only chats updated at or after this epoch ms'),
  cursor: z.string().optional().describe('nextCursor from the previous page'),
  limit: z.number().int().min(1).max(100).default(25),
});
export type McpListChatsInput = z.infer<typeof McpListChatsInput>;

export const McpGetChatInput = z.strictObject({
  jid: z
    .string()
    .min(1)
    .max(200)
    .describe('Chat id from list_chats (a phone or WhatsApp ID works)'),
});
export type McpGetChatInput = z.infer<typeof McpGetChatInput>;

export const McpGetMessagesInput = z.strictObject({
  jid: z.string().min(1).max(200).describe('Chat id from list_chats'),
  before: z.string().optional().describe('nextBefore from the previous page, for older messages'),
  limit: z.number().int().min(1).max(100).default(50),
});
export type McpGetMessagesInput = z.infer<typeof McpGetMessagesInput>;

export const McpGetStatsInput = z.strictObject({
  days: z.number().int().min(1).max(90).default(14).describe('Days of daily activity to include'),
});
export type McpGetStatsInput = z.infer<typeof McpGetStatsInput>;

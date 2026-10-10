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
  /** Loopback base URL on the port this server listens on (works only on the server's computer). */
  localUrl: z.string(),
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

export const McpGetActivityInput = z.strictObject({
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(28)
    .describe('Days to cover, ending now (today counts as one day)'),
});
export type McpGetActivityInput = z.infer<typeof McpGetActivityInput>;

// AI Sales Agent setup tools (scope `ai:setup`).

export const McpSetupTarget = z
  .enum(['instructions', 'handoff_rules', 'context_text'])
  .describe(
    'instructions = AI instructions; handoff_rules = hand-off rules; context_text = a Business context text item',
  );
export type McpSetupTarget = z.infer<typeof McpSetupTarget>;

export const McpGetAiAgentSetupInput = z.strictObject({});
export type McpGetAiAgentSetupInput = z.infer<typeof McpGetAiAgentSetupInput>;

export const McpGetAiContextItemInput = z.strictObject({
  id: z.number().int().positive().describe('Business context item id from get_ai_agent_setup'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Character offset for long items: pass nextOffset from the previous page'),
});
export type McpGetAiContextItemInput = z.infer<typeof McpGetAiContextItemInput>;

export const McpTryAiReplyInput = z.strictObject({
  message: z.string().trim().min(1).max(500).describe('A customer message to test'),
  instructions: z
    .string()
    .max(8000)
    .optional()
    .describe('Draft AI instructions to test instead of the saved ones'),
  handoffRules: z
    .string()
    .max(4000)
    .optional()
    .describe('Draft hand-off rules to test instead of the saved ones'),
});
export type McpTryAiReplyInput = z.infer<typeof McpTryAiReplyInput>;

export const McpUpdateAiSetupInput = z.strictObject({
  target: McpSetupTarget,
  itemId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('context_text only: the item to change; omit to add a new text item'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe('context_text only: item name (required when adding)'),
  text: z
    .string()
    .max(200_000)
    .describe(
      'The complete new text (not a diff). For a long item, read every page with get_ai_context_item first so nothing is lost.',
    ),
  reason: z
    .string()
    .trim()
    .min(5)
    .max(300)
    .describe('Why this change is being made; stored in the audit log and version history'),
});
export type McpUpdateAiSetupInput = z.infer<typeof McpUpdateAiSetupInput>;

export const McpGetAiSetupHistoryInput = z.strictObject({
  target: McpSetupTarget,
  itemId: z.number().int().positive().optional().describe('context_text only: the item'),
  limit: z.number().int().min(1).max(50).default(10),
});
export type McpGetAiSetupHistoryInput = z.infer<typeof McpGetAiSetupHistoryInput>;

export const McpGetAiSetupVersionInput = z.strictObject({
  versionId: z.number().int().positive().describe('versionId from get_ai_setup_history'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Character offset for long texts: pass nextOffset from the previous page'),
});
export type McpGetAiSetupVersionInput = z.infer<typeof McpGetAiSetupVersionInput>;

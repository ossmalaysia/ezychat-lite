import { z } from 'zod';

/**
 * AI agents in WhatsApp groups (design docs/features/ai-groups/design.md, confirmed 2026-10-28).
 * An agent with "Answer in groups" on answers, in a group an admin switched on, only a live message
 * that tags the business number (@mention) or quotes a message the AI sent. Every other group
 * message gets no reply. The AI never takes the group chat; the loop guard pauses it after
 * `AI_GROUP_LOOP_GUARD` answers in a row without a teammate message.
 */
export const AI_GROUP_LOOP_GUARD = 10;
/** The conversation part of a group answer: at most this many of the group's last messages. */
export const AI_GROUP_CONTEXT_MESSAGES = 20;

/** The group part of an `ai_tool_used` chat event (the lines in a group chat). */
export const AiGroupEvent = z.object({
  kind: z.enum(['answered', 'handover', 'paused']),
  /** The member the AI answered or handed over (a display name, never a number). */
  member: z.string().max(120).nullable(),
  /** answered: the member quoted an AI message (no @mention). */
  quoted: z.boolean().optional(),
});
export type AiGroupEvent = z.infer<typeof AiGroupEvent>;

/** One WhatsApp group of the agent's inbox on the agent page. */
export const AiGroupRow = z.object({
  jid: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative().nullable(),
  enabled: z.boolean(),
  /** The loop guard holds now in this group (the AI waits for a teammate message). */
  paused: z.boolean().default(false),
});
export type AiGroupRow = z.infer<typeof AiGroupRow>;

/** `GET /api/ai/agents/:agentId/groups` (admins): the switch, the inbox's groups and the guard. */
export const AiAgentGroups = z.object({
  enabled: z.boolean(),
  /** The agent's inbox (its WhatsApp number's name), null when the agent serves no inbox. */
  inboxName: z.string().nullable().default(null),
  groups: z.array(AiGroupRow),
  loopGuard: z.number().int().positive(),
});
export type AiAgentGroups = z.infer<typeof AiAgentGroups>;

/** `PUT /api/ai/agents/:agentId/groups` (admins): the agent's "Answer in groups" switch. */
export const AiAgentGroupsBody = z.strictObject({ enabled: z.boolean() });
export type AiAgentGroupsBody = z.infer<typeof AiAgentGroupsBody>;

/**
 * `GET /api/chats/:jid/ai-group` (anyone who may open the chat) and `PUT` (admins, body
 * `AiGroupChatBody`): whether the AI answers tags and quotes in this group.
 */
export const AiGroupChat = z.object({
  /** This group is switched on. */
  enabled: z.boolean(),
  /** The agent of the group's inbox, if any. */
  agentId: z.number().int().positive().nullable(),
  agentName: z.string().nullable(),
  /** The agent itself is on (else nothing is answered, whatever the switches say). */
  agentEnabled: z.boolean().default(false),
  /** The agent is on and its "Answer in groups" is on (else the group switch has no effect). */
  agentAnswersGroups: z.boolean(),
  /** The loop guard holds now: the AI waits for a teammate message in this group. */
  paused: z.boolean(),
});
export type AiGroupChat = z.infer<typeof AiGroupChat>;
export const AiGroupChatBody = z.strictObject({ enabled: z.boolean() });
export type AiGroupChatBody = z.infer<typeof AiGroupChatBody>;

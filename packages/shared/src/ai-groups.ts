import { z } from 'zod';

/**
 * AI agents in WhatsApp groups (design docs/features/ai-groups/design.md, confirmed 2026-10-28;
 * Open chat and per-group choices: docs/features/ai-groups-open-chat/design.md).
 * An agent with "Answer in groups" on answers in all groups of its inbox (new ones too) or in the
 * selected ones only, in its default mode or a group's own: **Tag and quote** answers only a live
 * message that tags the business number (@mention) or quotes a message the AI sent; **Open chat**
 * also answers its name, a member going on talking with it and an open question in its role, and
 * stays silent for a question to a specific person or members chatting. In both modes it never
 * discusses politics, race, religion or gender. The AI never takes the group chat; the loop guard
 * pauses it after `AI_GROUP_LOOP_GUARD` answers in a row without a teammate message.
 */
export const AI_GROUP_LOOP_GUARD = 10;
/** The conversation part of a group answer: at most this many of the group's last messages. */
export const AI_GROUP_CONTEXT_MESSAGES = 20;

/** How an agent answers in a group. */
export const AiGroupMode = z.enum(['tag', 'open']);
export type AiGroupMode = z.infer<typeof AiGroupMode>;
/** Which groups of its inbox an agent answers in: all (new ones too) or the selected ones only. */
export const AiGroupScope = z.enum(['all', 'selected']);
export type AiGroupScope = z.infer<typeof AiGroupScope>;
/** A group's choice: the agent's default mode, a mode of its own, or off. */
export const AiGroupSetting = z.enum(['default', 'open', 'tag', 'off']);
export type AiGroupSetting = z.infer<typeof AiGroupSetting>;
/** How the AI behaves in a group now. */
export const AiGroupEffectiveMode = z.enum(['tag', 'open', 'off']);
export type AiGroupEffectiveMode = z.infer<typeof AiGroupEffectiveMode>;

/** The group part of an `ai_tool_used` chat event (the lines in a group chat). */
export const AiGroupEvent = z.object({
  /** declined: a tagged or quoted question on a sensitive topic got the one polite line. */
  kind: z.enum(['answered', 'handover', 'paused', 'declined']),
  /** The member the AI answered or handed over (a display name, never a number). */
  member: z.string().max(120).nullable(),
  /** answered: the member quoted an AI message (no @mention). */
  quoted: z.boolean().optional(),
  /** answered: in Open chat, without a tag or a quote (its name, a follow-up, an open question). */
  openChat: z.boolean().optional(),
});
export type AiGroupEvent = z.infer<typeof AiGroupEvent>;

/** One WhatsApp group of the agent's inbox on the agent page. */
export const AiGroupRow = z.object({
  jid: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative().nullable(),
  /** The group's choice is not Off (a group never set follows the agent's scope). */
  enabled: z.boolean(),
  /** The group's choice as the list shows it. */
  setting: AiGroupSetting.default('default'),
  /** How the AI behaves there while the agent answers in groups. */
  mode: AiGroupEffectiveMode.default('tag'),
  /** The loop guard holds now in this group (the AI waits for a teammate message). */
  paused: z.boolean().default(false),
});
export type AiGroupRow = z.infer<typeof AiGroupRow>;

/** `GET /api/ai/agents/:agentId/groups` (admins): the settings, the inbox's groups and the guard. */
export const AiAgentGroups = z.object({
  /** "Answer in groups". */
  enabled: z.boolean(),
  scope: AiGroupScope.default('selected'),
  /** The default mode of the agent's groups. */
  mode: AiGroupMode.default('tag'),
  /** The agent's inbox (its WhatsApp number's name), null when the agent serves no inbox. */
  inboxName: z.string().nullable().default(null),
  groups: z.array(AiGroupRow),
  loopGuard: z.number().int().positive(),
});
export type AiAgentGroups = z.infer<typeof AiAgentGroups>;

/** `PUT /api/ai/agents/:agentId/groups` (admins): any of the agent's group settings. */
export const AiAgentGroupsBody = z
  .strictObject({
    enabled: z.boolean().optional(),
    scope: AiGroupScope.optional(),
    mode: AiGroupMode.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nothing to change',
  });
export type AiAgentGroupsBody = z.infer<typeof AiAgentGroupsBody>;

/**
 * `GET /api/chats/:jid/ai-group` (anyone who may open the chat) and `PUT` (admins, body
 * `AiGroupChatBody`): the group's choice and how the AI behaves there.
 */
export const AiGroupChat = z.object({
  /** The group's choice is not Off. */
  enabled: z.boolean(),
  setting: AiGroupSetting.default('default'),
  /** How the AI behaves here while the agent answers in groups ('off': never). */
  mode: AiGroupEffectiveMode.default('tag'),
  /** The agent of the group's inbox, if any. */
  agentId: z.number().int().positive().nullable(),
  agentName: z.string().nullable(),
  /** The agent's default mode (what "default" means here). */
  agentMode: AiGroupMode.default('tag'),
  /** The agent's scope (what a group never set follows). */
  agentScope: AiGroupScope.default('selected'),
  /** The agent itself is on (else nothing is answered, whatever the switches say). */
  agentEnabled: z.boolean().default(false),
  /** The agent is on and its "Answer in groups" is on (else the group's choice has no effect). */
  agentAnswersGroups: z.boolean(),
  /** The loop guard holds now: the AI waits for a teammate message in this group. */
  paused: z.boolean(),
});
export type AiGroupChat = z.infer<typeof AiGroupChat>;
/** `{ setting }`, or the earlier `{ enabled }` (true = the agent's default mode, false = Off). */
export const AiGroupChatBody = z.union([
  z.strictObject({ setting: AiGroupSetting }),
  z.strictObject({ enabled: z.boolean() }),
]);
export type AiGroupChatBody = z.infer<typeof AiGroupChatBody>;

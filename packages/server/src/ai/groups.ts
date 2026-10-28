import {
  AI_GROUP_LOOP_GUARD,
  type AiAgentGroups,
  type AiAgentGroupsBody,
  type AiGroupChat,
  type AiGroupEffectiveMode,
  type AiGroupEvent,
  type AiGroupSetting,
  type AiToolUsedPayload,
  type Message,
} from '@ezychat/shared';
import { normalizeContactJid } from '@ezychat/wa';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { audit } from '../db/audit.js';
import { getAliases } from '../chats/aliases.js';
import { HttpError, errors } from '../http/errors.js';
import { inboxOfKey, parseChatKey } from '../inboxes/keys.js';
import { getChats } from '../wa-bridge/index.js';
import { agentById, agentForInbox, setAgentGroupSettings, type AgentRow } from './agents.js';

/**
 * AI agents in WhatsApp groups (designs docs/features/ai-groups/design.md and
 * docs/features/ai-groups-open-chat/design.md). The settings (the agent's "Answer in groups", scope and
 * default mode, migrations 024/025; one choice per group in `ai_group_chats`), whether a live group
 * message is addressed to the AI by a tag of the business number or a quote of an AI answer, who is in
 * a conversation with the AI, and the loop guard. The Open-chat decision is `ai/group-gate.ts`; the
 * turn itself runs in `ai/service.ts`.
 */

/** How a member addressed the AI directly (rule-based, both modes). */
export type GroupTrigger = 'tag' | 'quote';
/**
 * How a group message reaches the AI: a direct trigger, or in Open chat (decided by the gate) its
 * name, the member going on talking with it, or an open question in its role.
 */
export type GroupReach = GroupTrigger | 'named' | 'continue' | 'open';

type Actor = { userId: number; ip: string | null };

/** The own JIDs and LIDs of one inbox, normalized: its session now, else the remembered number. */
export function inboxOwnJids(ctx: AppContext, inboxId: number): Set<string> {
  const ids: Array<string | null | undefined> = [];
  try {
    const me = ctx.inboxes.connections.adapter(inboxId).status.me;
    ids.push(me?.jid, me?.lid);
  } catch {
    // a removed inbox has no connection: its remembered number only
  }
  ids.push(ctx.inboxes.repo.get(inboxId)?.own_jid);
  return new Set(
    ids.flatMap((jid) => {
      const normalized = normalizeContactJid(jid);
      return normalized ? [normalized] : [];
    }),
  );
}

/** The stored WhatsApp mentions of a message; corrupt metadata is no mention. */
function storedMentions(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.flatMap((jid: unknown) => {
          const normalized = normalizeContactJid(jid);
          return normalized ? [normalized] : [];
        })
      : [];
  } catch {
    return [];
  }
}

/**
 * Whether a stored live group message is addressed to the AI: `tag` when its WhatsApp mentions
 * name the inbox's own number (JID or LID, through known aliases), `quote` when it quotes a message
 * of this chat sent by the agent's AI user; else null. Keyword or name matches never count.
 */
export function addressedToAi(
  ctx: AppContext,
  input: { chatJid: string; messageId: string; quotedId: string | null; aiUserId: number },
): GroupTrigger | null {
  const row = ctx.db
    .prepare('SELECT mentioned_jids FROM messages WHERE id = ? AND chat_jid = ?')
    .get(input.messageId, input.chatJid) as { mentioned_jids: string | null } | undefined;
  const mentions = storedMentions(row?.mentioned_jids);
  if (mentions.length) {
    const own = inboxOwnJids(ctx, inboxOfKey(input.chatJid));
    const aliases = getAliases(ctx);
    if (mentions.some((jid) => own.has(jid) || aliases.group(jid).some((id) => own.has(id))))
      return 'tag';
  }
  if (
    input.quotedId &&
    ctx.db
      .prepare(
        'SELECT 1 FROM messages WHERE id = ? AND chat_jid = ? AND from_me = 1 AND sent_by_user_id = ?',
      )
      .get(input.quotedId, input.chatJid, input.aiUserId)
  )
    return 'quote';
  return null;
}

/** Whether a stored message tags anyone (a message not tagging the business then tags a member). */
export function tagsSomeone(db: DB, input: { chatJid: string; messageId: string }): boolean {
  const row = db
    .prepare('SELECT mentioned_jids FROM messages WHERE id = ? AND chat_jid = ?')
    .get(input.messageId, input.chatJid) as { mentioned_jids: string | null } | undefined;
  return storedMentions(row?.mentioned_jids).length > 0;
}

/** A group's saved choice; null = never set. */
function savedSetting(db: DB, jid: string): AiGroupSetting | null {
  const row = db.prepare('SELECT setting FROM ai_group_chats WHERE chat_jid = ?').get(jid) as
    { setting: AiGroupSetting } | undefined;
  return row?.setting ?? null;
}

/** The choice a group shows: its own, else what the agent's scope gives it (all → default). */
export const shownSetting = (
  saved: AiGroupSetting | null,
  agent: Pick<AgentRow, 'groupScope'> | null,
): AiGroupSetting => saved ?? (agent?.groupScope === 'all' ? 'default' : 'off');

/** How the AI behaves in a group with this choice, for this agent ('off' never answers). */
export const effectiveMode = (
  setting: AiGroupSetting,
  agent: Pick<AgentRow, 'groupMode'> | null,
): AiGroupEffectiveMode =>
  setting === 'off' || !agent ? 'off' : setting === 'default' ? agent.groupMode : setting;

/** How the agent behaves in this group now, its "Answer in groups" switch aside. */
export function groupMode(db: DB, jid: string, agent: AgentRow): AiGroupEffectiveMode {
  return effectiveMode(shownSetting(savedSetting(db, jid), agent), agent);
}

function writeGroupSetting(db: DB, jid: string, setting: AiGroupSetting, userId: number) {
  db.prepare(
    `INSERT INTO ai_group_chats (chat_jid, enabled, setting, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_jid) DO UPDATE SET enabled = excluded.enabled, setting = excluded.setting,
     updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(jid, setting === 'off' ? 0 : 1, setting, Date.now(), userId);
}

/**
 * Whether this member is in a conversation with the AI (Open chat's "goes on talking"): the AI's
 * latest group message answered them (quoted their message) and no teammate wrote since.
 */
export function inConversationWithAi(
  db: DB,
  input: { chatJid: string; senderJid: string | null; aiUserId: number },
): boolean {
  if (!input.senderJid) return false;
  const last = db
    .prepare(
      `SELECT m.timestamp AS at, q.sender_jid AS member FROM messages m
       JOIN messages q ON q.id = m.quoted_id AND q.chat_jid = m.chat_jid
       WHERE m.chat_jid = ? AND m.from_me = 1 AND m.sent_by_user_id = ? AND m.status <> 'failed'
       ORDER BY m.timestamp DESC, m.rowid DESC LIMIT 1`,
    )
    .get(input.chatJid, input.aiUserId) as { at: number; member: string | null } | undefined;
  if (!last?.member || normalizeContactJid(last.member) !== normalizeContactJid(input.senderJid))
    return false;
  return loopGuard(db, input.chatJid).since <= last.at;
}

/** The loop guard of one group: AI messages since the last teammate (or phone) message. */
export interface LoopGuardState {
  /** AI messages in a row (failed sends not counted). */
  inRow: number;
  paused: boolean;
  /** epoch ms of the last teammate message (0 = none): the start of the current run. */
  since: number;
}

export function loopGuard(db: DB, jid: string): LoopGuardState {
  const last = db
    .prepare(
      `SELECT max(m.timestamp) AS at FROM messages m LEFT JOIN users u ON u.id = m.sent_by_user_id
       WHERE m.chat_jid = ? AND m.from_me = 1 AND (u.id IS NULL OR u.kind <> 'ai')`,
    )
    .get(jid) as { at: number | null };
  const since = last.at ?? 0;
  const { n } = db
    .prepare(
      `SELECT count(*) AS n FROM messages m JOIN users u ON u.id = m.sent_by_user_id
       WHERE m.chat_jid = ? AND m.from_me = 1 AND u.kind = 'ai' AND m.status <> 'failed'
       AND m.timestamp > ?`,
    )
    .get(jid, since) as { n: number };
  return { inRow: n, paused: n >= AI_GROUP_LOOP_GUARD, since };
}

/** Whether this run (since the last teammate message) already has its "AI paused" line. */
export function pausedLineWritten(db: DB, jid: string, since: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM chat_events WHERE chat_jid = ? AND type = 'ai_tool_used' AND at >= ?
       AND json_extract(payload, '$.group.kind') = 'paused' LIMIT 1`,
    )
    .get(jid, since);
}

const PHONE_LIKE = /^[+\d\s().-]*$/;
const MEMBER_NAME_CHARACTERS = 120;

/**
 * A group member's display name for the prompt, the chat line and the notification: the team's
 * customer profile name, else the saved contact name, else their WhatsApp name. Never a number
 * (a name that is only digits counts as none).
 */
export function memberName(ctx: AppContext, message: Message): string | null {
  const saved = message.senderJid
    ? (
        ctx.db.prepare('SELECT saved_name FROM contacts WHERE jid = ?').get(message.senderJid) as
          { saved_name: string | null } | undefined
      )?.saved_name
    : null;
  for (const candidate of [message.senderProfile?.name, saved, message.senderName]) {
    const name = candidate?.trim();
    if (name && !PHONE_LIKE.test(name)) return name.slice(0, MEMBER_NAME_CHARACTERS);
  }
  return null;
}

/** Group text for the model: numeric tags (unknown people) never show a phone number. */
export const groupText = (text: string): string => text.replace(/@\+?\d{5,}/g, '@member');

/** One group line of the agent (`ai_tool_used` chat event with `group`). */
export function groupLine(
  agent: Pick<AgentRow, 'displayName'>,
  group: AiGroupEvent,
): AiToolUsedPayload {
  return {
    title: agent.displayName.trim().slice(0, 120) || 'AI',
    sourceLabel: 'WhatsApp group',
    group,
  };
}

/** The group chats of an inbox with their choice and mode for this agent, by name. */
function inboxGroups(db: DB, inboxId: number, agent: AgentRow) {
  return (
    db
      .prepare(
        `SELECT c.jid, c.name, g.setting FROM chats c
         LEFT JOIN ai_group_chats g ON g.chat_jid = c.jid
         WHERE c.type = 'group' AND c.inbox_id = ? ORDER BY lower(c.name), c.jid`,
      )
      .all(inboxId) as Array<{ jid: string; name: string | null; setting: AiGroupSetting | null }>
  ).map((row) => {
    const setting = shownSetting(row.setting, agent);
    return {
      jid: row.jid,
      name: row.name?.trim() || parseChatKey(row.jid).waJid,
      memberCount: null,
      enabled: setting !== 'off',
      setting,
      mode: effectiveMode(setting, agent),
      paused: loopGuard(db, row.jid).paused,
    };
  });
}

const agentNotFound = () => new HttpError(404, 'agent_not_found', 'AI agent not found');

const requireAgent = (ctx: AppContext, agentId: number): AgentRow => {
  const agent = agentById(ctx.db, agentId);
  if (!agent) throw agentNotFound();
  return agent;
};

/** `GET /api/ai/agents/:agentId/groups`: the settings, the groups of the agent's inbox, the guard. */
export function agentGroups(ctx: AppContext, agentId: number): AiAgentGroups {
  const agent = requireAgent(ctx, agentId);
  return {
    enabled: agent.answerGroups,
    scope: agent.groupScope,
    mode: agent.groupMode,
    inboxName: agent.inboxId === null ? null : (ctx.inboxes.repo.get(agent.inboxId)?.name ?? null),
    groups: agent.inboxId === null ? [] : inboxGroups(ctx.db, agent.inboxId, agent),
    loopGuard: AI_GROUP_LOOP_GUARD,
  };
}

/**
 * `PUT /api/ai/agents/:agentId/groups`: the agent's "Answer in groups" switch, scope and default mode
 * (audited with the changed values). A change that can silence a group stops its waiting answers.
 */
export function setAgentGroups(
  ctx: AppContext,
  agentId: number,
  body: AiAgentGroupsBody,
  actor: Actor,
): AiAgentGroups {
  const agent = requireAgent(ctx, agentId);
  setAgentGroupSettings(ctx.db, agent.id, {
    ...(body.enabled === undefined ? {} : { answerGroups: body.enabled }),
    ...(body.scope ? { scope: body.scope } : {}),
    ...(body.mode ? { mode: body.mode } : {}),
  });
  audit(ctx.db, {
    userId: actor.userId,
    action: 'ai.groups_switch',
    ip: actor.ip,
    meta: { agentId: agent.id, agentName: agent.displayName, ...body },
  });
  if (body.enabled === false || body.scope === 'selected' || body.mode === 'tag')
    ctx.services.ai?.stopGroupTurns({ agentId: agent.id });
  return agentGroups(ctx, agent.id);
}

const requireGroupChat = (ctx: AppContext, jid: string) => {
  const chat = getChats(ctx).get(jid);
  if (!chat) throw errors.notFound('Chat');
  if (chat.type !== 'group') throw errors.validation('Only a WhatsApp group has this switch');
  return chat;
};

/** `GET /api/chats/:jid/ai-group`: the group's choice and mode, its inbox's agent and the guard. */
export function groupChatStatus(ctx: AppContext, jid: string): AiGroupChat {
  requireGroupChat(ctx, jid);
  const agent = agentForInbox(ctx.db, inboxOfKey(jid));
  const setting = shownSetting(savedSetting(ctx.db, jid), agent);
  return {
    enabled: setting !== 'off',
    setting,
    mode: effectiveMode(setting, agent),
    agentMode: agent?.groupMode ?? 'tag',
    agentScope: agent?.groupScope ?? 'selected',
    agentId: agent?.id ?? null,
    agentName: agent?.displayName ?? null,
    agentEnabled: !!agent?.enabled,
    agentAnswersGroups: !!agent && agent.enabled && agent.answerGroups,
    paused: loopGuard(ctx.db, jid).paused,
  };
}

/** `PUT /api/chats/:jid/ai-group` (admins): one group's choice (audited). */
export function setGroupChat(
  ctx: AppContext,
  jid: string,
  setting: AiGroupSetting,
  actor: Actor,
): AiGroupChat {
  const chat = requireGroupChat(ctx, jid);
  writeGroupSetting(ctx.db, jid, setting, actor.userId);
  audit(ctx.db, {
    userId: actor.userId,
    action: 'ai.group_switch',
    ip: actor.ip,
    meta: { chatJid: jid, groupName: chat.name, setting, enabled: setting !== 'off' },
  });
  // Off, or a mode that may not answer what is waiting: drop the waiting answers.
  if (setting !== 'open') ctx.services.ai?.stopGroupTurns({ jid });
  return groupChatStatus(ctx, jid);
}

import { randomUUID } from 'node:crypto';
import type { AiAgentPreset, AiGroupMode, AiGroupScope } from '@ezychat/shared';
import type { DB } from '../db/index.js';
import type { SettingsStore } from '../db/settings.js';

/**
 * The only SQL for AI agents (table `ai_agents`, migration 015). The name and on/off of an agent
 * live on its `users` row (`display_name`, `disabled_at`) so assignee and sender rendering keep
 * working; a deleted agent has no `ai_agents` row and its user is flagged `ai_deleted_at`.
 */
export interface AgentRow {
  id: number;
  userId: number;
  /** The inbox this agent serves; null = none. */
  inboxId: number | null;
  preset: AiAgentPreset;
  /** null = never saved: the preset's defaults apply. A saved blank stays blank. */
  instructions: string | null;
  handoffRules: string | null;
  displayName: string;
  enabled: boolean;
  /** "Answer in groups" (migration 024). */
  answerGroups: boolean;
  /** All groups of its inbox (new ones too) or the selected ones only (migration 025). */
  groupScope: AiGroupScope;
  /** The default mode of its groups (migration 025). */
  groupMode: AiGroupMode;
  createdAt: number;
  updatedAt: number;
}

export type AgentErrorCode =
  'agent_limit' | 'inbox_has_agent' | 'agent_not_found' | 'internal_too_large';

export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode) {
    super(code);
    this.name = 'AgentError';
  }
}

/** The setting that held the one AI Sales Agent's texts before migration 015. */
const MEMBER_KEY = 'ai_sales_member';
/** Set once the member texts moved into agent 1 (and other active inboxes got an agent). */
const AGENTS_MIGRATED_KEY = 'ai_agents_migrated';

interface Row {
  id: number;
  userId: number;
  inboxId: number | null;
  preset: AiAgentPreset;
  instructions: string | null;
  handoffRules: string | null;
  displayName: string;
  disabledAt: number | null;
  answerGroups: number;
  groupScope: AiGroupScope;
  groupMode: AiGroupMode;
  createdAt: number;
  updatedAt: number;
}

const SELECT = `SELECT a.id, a.user_id AS userId, a.inbox_id AS inboxId, a.preset,
  a.instructions, a.handoff_rules AS handoffRules, u.display_name AS displayName,
  u.disabled_at AS disabledAt, a.answer_groups AS answerGroups,
  a.group_scope AS groupScope, a.group_mode AS groupMode, a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM ai_agents a JOIN users u ON u.id = a.user_id
  WHERE u.ai_deleted_at IS NULL`;

const toAgent = ({ disabledAt, answerGroups, ...row }: Row): AgentRow => ({
  ...row,
  enabled: disabledAt === null,
  answerGroups: answerGroups === 1,
});

function one(db: DB, where: string, value: number): AgentRow | null {
  const row = db.prepare(`${SELECT} AND ${where} = ?`).get(value) as Row | undefined;
  return row ? toAgent(row) : null;
}

/** Every agent, oldest first. */
export function listAgents(db: DB): AgentRow[] {
  return (db.prepare(`${SELECT} ORDER BY a.id`).all() as Row[]).map(toAgent);
}

export const agentById = (db: DB, id: number): AgentRow | null => one(db, 'a.id', id);

export const agentByUserId = (db: DB, userId: number): AgentRow | null =>
  one(db, 'a.user_id', userId);

export const agentForInbox = (db: DB, inboxId: number): AgentRow | null =>
  one(db, 'a.inbox_id', inboxId);

/**
 * The agent old clients mean when they name none: the only agent, else the agent of inbox 1,
 * else the lowest id.
 */
export function defaultAgent(db: DB): AgentRow | null {
  const agents = listAgents(db);
  if (agents.length <= 1) return agents[0] ?? null;
  return agents.find((a) => a.inboxId === 1) ?? agents[0]!;
}

function assertInboxFree(db: DB, inboxId: number | null, agentId: number | null): void {
  if (inboxId === null) return;
  const holder = db.prepare('SELECT id FROM ai_agents WHERE inbox_id = ?').get(inboxId) as
    { id: number } | undefined;
  if (holder && holder.id !== agentId) throw new AgentError('inbox_has_agent');
}

export interface NewAgent {
  userId: number;
  inboxId: number | null;
  preset: AiAgentPreset;
  instructions: string | null;
  handoffRules: string | null;
}

/** Adds the `ai_agents` row for an existing `kind = 'ai'` user. */
export function createAgentRow(db: DB, agent: NewAgent, now = Date.now()): AgentRow {
  assertInboxFree(db, agent.inboxId, null);
  const id = Number(
    db
      .prepare(
        `INSERT INTO ai_agents (user_id, inbox_id, preset, instructions, handoff_rules, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.userId,
        agent.inboxId,
        agent.preset,
        agent.instructions,
        agent.handoffRules,
        now,
        now,
      ).lastInsertRowid,
  );
  return agentById(db, id)!;
}

export interface AgentTexts {
  preset?: AiAgentPreset;
  /** null = back to the preset's defaults. */
  instructions?: string | null;
  handoffRules?: string | null;
}

/** Changes only the given fields. */
export function updateAgentTexts(db: DB, id: number, texts: AgentTexts, now = Date.now()): void {
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];
  if (texts.preset !== undefined) {
    sets.push('preset = ?');
    values.push(texts.preset);
  }
  if (texts.instructions !== undefined) {
    sets.push('instructions = ?');
    values.push(texts.instructions);
  }
  if (texts.handoffRules !== undefined) {
    sets.push('handoff_rules = ?');
    values.push(texts.handoffRules);
  }
  const changed = db
    .prepare(`UPDATE ai_agents SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id).changes;
  if (!changed) throw new AgentError('agent_not_found');
}

/** The agent's group settings (migrations 024 and 025): only the given fields change. */
export function setAgentGroupSettings(
  db: DB,
  id: number,
  settings: { answerGroups?: boolean; scope?: AiGroupScope; mode?: AiGroupMode },
  now = Date.now(),
): void {
  const changed = db
    .prepare(
      `UPDATE ai_agents SET answer_groups = coalesce(?, answer_groups),
       group_scope = coalesce(?, group_scope), group_mode = coalesce(?, group_mode), updated_at = ?
       WHERE id = ?`,
    )
    .run(
      settings.answerGroups === undefined ? null : settings.answerGroups ? 1 : 0,
      settings.scope ?? null,
      settings.mode ?? null,
      now,
      id,
    ).changes;
  if (!changed) throw new AgentError('agent_not_found');
}

/** Binds the agent to an inbox (null = none). One agent per inbox. */
export function setAgentInbox(db: DB, id: number, inboxId: number | null, now = Date.now()): void {
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM ai_agents WHERE id = ?').get(id))
      throw new AgentError('agent_not_found');
    assertInboxFree(db, inboxId, id);
    db.prepare('UPDATE ai_agents SET inbox_id = ?, updated_at = ? WHERE id = ?').run(
      inboxId,
      now,
      id,
    );
  })();
}

/**
 * Removes the agent and its Business context items. Its user row stays for message history,
 * disabled and flagged deleted. Release its chats before calling this.
 */
export function deleteAgentRow(db: DB, id: number, now = Date.now()): void {
  db.transaction(() => {
    const row = db.prepare('SELECT user_id AS userId FROM ai_agents WHERE id = ?').get(id) as
      { userId: number } | undefined;
    if (!row) throw new AgentError('agent_not_found');
    db.prepare('DELETE FROM ai_documents WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM reply_phrases WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM ai_agents WHERE id = ?').run(id);
    db.prepare(
      'UPDATE users SET disabled_at = coalesce(disabled_at, ?), ai_deleted_at = ? WHERE id = ?',
    ).run(now, now, row.userId);
  })();
}

const storedText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Permanent, idempotent start-up step (updates skip versions, so it never leaves the code). Once:
 * copies the `ai_sales_member` texts into agent 1 (a non-string is "never saved" = NULL, a blank
 * stays blank), gives agent 1 any item or version written without an agent, and creates one agent
 * per other active inbox that has none (a new AI user with the same name and on/off, the same
 * preset and texts, and copies of the items) so no inbox loses its AI. The chats agent 1's user
 * owned in such an inbox move to that inbox's new agent, so none stays with an AI that will not
 * answer it.
 */
export function migrateMemberSetting(db: DB, settings: SettingsStore, now = Date.now()): void {
  db.transaction(() => {
    if (settings.get<boolean>(AGENTS_MIGRATED_KEY, false)) return;
    const first = agentForInbox(db, 1) ?? defaultAgent(db);
    if (first) {
      const stored = settings.get<unknown>(MEMBER_KEY, null);
      const old =
        stored && typeof stored === 'object' && !Array.isArray(stored)
          ? (stored as Record<string, unknown>)
          : {};
      const texts = {
        instructions: storedText(old.instructions),
        handoffRules: storedText(old.handoffRules),
      };
      updateAgentTexts(db, first.id, texts, now);
      db.prepare('UPDATE ai_documents SET agent_id = ? WHERE agent_id IS NULL').run(first.id);
      db.prepare('UPDATE ai_setup_versions SET agent_id = ? WHERE agent_id IS NULL').run(first.id);

      const user = db
        .prepare('SELECT display_name AS name, disabled_at AS disabledAt FROM users WHERE id = ?')
        .get(first.userId) as { name: string; disabledAt: number | null };
      const inboxes = db
        .prepare(
          `SELECT id FROM inboxes WHERE removed_at IS NULL
           AND id NOT IN (SELECT inbox_id FROM ai_agents WHERE inbox_id IS NOT NULL) ORDER BY id`,
        )
        .all() as Array<{ id: number }>;
      for (const inbox of inboxes) {
        const userId = Number(
          db
            .prepare(
              "INSERT INTO users(username, display_name, password_hash, role, kind, disabled_at, created_at) VALUES (?, ?, '', 'agent', 'ai', ?, ?)",
            )
            .run(`ai-${randomUUID()}`, user.name, user.disabledAt, now).lastInsertRowid,
        );
        const agent = createAgentRow(
          db,
          { userId, inboxId: inbox.id, preset: first.preset, ...texts },
          now,
        );
        db.prepare(
          `INSERT INTO ai_documents (agent_id, name, kind, size, text, internal, created_at, updated_at)
           SELECT ?, name, kind, size, text, internal, created_at, updated_at
           FROM ai_documents WHERE agent_id = ? ORDER BY created_at, id`,
        ).run(agent.id, first.id);
        // The one AI member owned chats in every inbox: they stay with the AI of their inbox.
        db.prepare('UPDATE chats SET assigned_to = ? WHERE inbox_id = ? AND assigned_to = ?').run(
          userId,
          inbox.id,
          first.userId,
        );
      }
    }
    settings.set(AGENTS_MIGRATED_KEY, true);
  })();
}

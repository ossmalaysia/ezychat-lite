import { ConnectorEntry, type ConnectorActivity } from '@ezychat/shared';
import type { DB } from '../../db/index.js';
import type { PartnerTool } from './mcp.js';

/** The only SQL of partner (MCP) connections (migration 023). */

/** A value a read tool returned stays usable this long (guard `valueFrom`). */
export const VALUE_TTL_MS = 24 * 3_600_000;
/** Calls counted by the guard `limits` (per chat and per day: the last 24 hours). */
export const LIMIT_WINDOW_MS = 24 * 3_600_000;
/** A customer message that confirmed a write is remembered this long (never confirms twice). */
export const CONSENT_TTL_MS = 30 * 24 * 3_600_000;
export const ACTIVITY_LIMIT = 50;
/** Values recorded per read result. */
const MAX_VALUES_PER_RESULT = 500;

export type ConnectionState = 'connected' | 'needs_sign_in' | 'unreachable' | 'disconnected';

export interface ConnectionRow {
  connectorId: string;
  state: ConnectionState;
  entry: ConnectorEntry;
  /** Encrypted secret blob, or null after a disconnect. */
  secret: string | null;
  account: string | null;
  keyEnd: string | null;
  fields: Record<string, string>;
  tools: PartnerTool[];
  connectedAt: number | null;
  updatedAt: number;
}

interface RawConnection {
  connector_id: string;
  state: ConnectionState;
  entry_json: string;
  secret: string | null;
  account: string | null;
  key_end: string | null;
  fields_json: string;
  tools_json: string;
  connected_at: number | null;
  updated_at: number;
}

function json<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toRow(raw: RawConnection): ConnectionRow | null {
  const entry = ConnectorEntry.safeParse(json<unknown>(raw.entry_json, null));
  if (!entry.success) return null;
  return {
    connectorId: raw.connector_id,
    state: raw.state,
    entry: entry.data,
    secret: raw.secret,
    account: raw.account,
    keyEnd: raw.key_end,
    fields: json<Record<string, string>>(raw.fields_json, {}),
    tools: json<PartnerTool[]>(raw.tools_json, []),
    connectedAt: raw.connected_at,
    updatedAt: raw.updated_at,
  };
}

export function getConnection(db: DB, id: string): ConnectionRow | null {
  const raw = db.prepare('SELECT * FROM connector_connections WHERE connector_id = ?').get(id) as
    RawConnection | undefined;
  return raw ? toRow(raw) : null;
}

export function listConnections(db: DB): ConnectionRow[] {
  return (
    db.prepare('SELECT * FROM connector_connections ORDER BY connector_id').all() as RawConnection[]
  )
    .map(toRow)
    .filter((row): row is ConnectionRow => row !== null);
}

export function saveConnection(db: DB, row: Omit<ConnectionRow, 'updatedAt'>, now: number): void {
  db.prepare(
    `INSERT INTO connector_connections (connector_id, state, entry_json, secret, account, key_end,
       fields_json, tools_json, connected_at, updated_at)
     VALUES (@id, @state, @entry, @secret, @account, @keyEnd, @fields, @tools, @connectedAt, @now)
     ON CONFLICT(connector_id) DO UPDATE SET state = excluded.state, entry_json = excluded.entry_json,
       secret = excluded.secret, account = excluded.account, key_end = excluded.key_end,
       fields_json = excluded.fields_json, tools_json = excluded.tools_json,
       connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
  ).run({
    id: row.connectorId,
    state: row.state,
    entry: JSON.stringify(row.entry),
    secret: row.secret,
    account: row.account,
    keyEnd: row.keyEnd,
    fields: JSON.stringify(row.fields),
    tools: JSON.stringify(row.tools),
    connectedAt: row.connectedAt,
    now,
  });
}

export function setState(db: DB, id: string, state: ConnectionState, now: number): void {
  db.prepare(
    'UPDATE connector_connections SET state = ?, updated_at = ? WHERE connector_id = ?',
  ).run(state, now, id);
}

export function setTools(db: DB, id: string, tools: PartnerTool[], now: number): void {
  db.prepare(
    'UPDATE connector_connections SET tools_json = ?, updated_at = ? WHERE connector_id = ?',
  ).run(JSON.stringify(tools), now, id);
}

export function setSecret(db: DB, id: string, secret: string | null, now: number): void {
  db.prepare(
    'UPDATE connector_connections SET secret = ?, updated_at = ? WHERE connector_id = ?',
  ).run(secret, now, id);
}

/** Disconnect: the secret and the account go, the entry copy and settings stay. */
export function clearConnection(db: DB, id: string, now: number): void {
  db.prepare(
    `UPDATE connector_connections SET state = 'disconnected', secret = NULL, account = NULL,
       key_end = NULL, connected_at = NULL, updated_at = ? WHERE connector_id = ?`,
  ).run(now, id);
}

// ── per-agent settings ──────────────────────────────────────────────────────────────────────

/**
 * One tool switch as an admin left it, with the access the tool had then: a switch set while the
 * tool was a look-up never turns on a tool the list later made a write tool.
 */
export interface StoredToolSwitch {
  on: boolean;
  access: 'read' | 'write';
}

export interface StoredAgentSettings {
  settings: Record<string, unknown>;
  tools: Record<string, StoredToolSwitch>;
}

export function readAgentSettings(db: DB, id: string, agentId: number): StoredAgentSettings | null {
  const row = db
    .prepare(
      'SELECT settings_json, tools_json FROM connector_agent_settings WHERE connector_id = ? AND agent_id = ?',
    )
    .get(id, agentId) as { settings_json: string; tools_json: string } | undefined;
  if (!row) return null;
  return {
    settings: json<Record<string, unknown>>(row.settings_json, {}),
    tools: json<Record<string, StoredToolSwitch>>(row.tools_json, {}),
  };
}

export function writeAgentSettings(
  db: DB,
  id: string,
  agentId: number,
  value: StoredAgentSettings,
  now: number,
): void {
  db.prepare(
    `INSERT INTO connector_agent_settings (connector_id, agent_id, settings_json, tools_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(connector_id, agent_id) DO UPDATE SET settings_json = excluded.settings_json,
       tools_json = excluded.tools_json, updated_at = excluded.updated_at`,
  ).run(id, agentId, JSON.stringify(value.settings), JSON.stringify(value.tools), now);
}

// ── activity ────────────────────────────────────────────────────────────────────────────────

export type ActivityReason = NonNullable<ConnectorActivity['reason']>;

export function addActivity(
  db: DB,
  row: {
    connectorId: string;
    kind: ConnectorActivity['kind'];
    agentId: number | null;
    chatJid: string | null;
    tool: string;
    reason?: ActivityReason | null;
  },
  now: number,
): void {
  db.prepare(
    `INSERT INTO connector_activity (connector_id, kind, agent_id, chat_jid, tool, reason, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.connectorId, row.kind, row.agentId, row.chatJid, row.tool, row.reason ?? null, now);
}

/** Newest first, at most 50; names from the agent's user row and the chat (saved name first). */
export function listActivity(db: DB, id: string): ConnectorActivity[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.kind, a.tool, a.reason, u.display_name AS agentName,
              c.name AS chatName, p.name AS profileName
       FROM connector_activity a
       LEFT JOIN ai_agents g ON g.id = a.agent_id
       LEFT JOIN users u ON u.id = g.user_id
       LEFT JOIN chats c ON c.jid = a.chat_jid
       LEFT JOIN customer_profiles p ON p.chat_jid = a.chat_jid
       WHERE a.connector_id = ?
       ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    )
    .all(id, ACTIVITY_LIMIT) as Array<{
    id: number;
    at: number;
    kind: ConnectorActivity['kind'];
    tool: string;
    reason: ActivityReason | null;
    agentName: string | null;
    chatName: string | null;
    profileName: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    agentName: row.agentName ?? '',
    customer: row.profileName?.trim() || row.chatName || '',
    tool: row.tool,
    reason: row.reason,
  }));
}

// ── guard data ──────────────────────────────────────────────────────────────────────────────

/** Values a read tool returned in this chat (`valueFrom`); old values are dropped. */
export function recordValues(
  db: DB,
  id: string,
  chatJid: string,
  tool: string,
  values: readonly string[],
  now: number,
): void {
  const insert = db.prepare(
    'INSERT INTO connector_values (connector_id, chat_jid, tool, value, at) VALUES (?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    db.prepare('DELETE FROM connector_values WHERE at < ?').run(now - VALUE_TTL_MS);
    for (const value of values.slice(0, MAX_VALUES_PER_RESULT))
      insert.run(id, chatJid, tool, value.toLowerCase(), now);
  })();
}

export function hasValue(
  db: DB,
  id: string,
  chatJid: string,
  tool: string,
  value: string,
  now: number,
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM connector_values
       WHERE connector_id = ? AND chat_jid = ? AND tool = ? AND value = ? AND at >= ? LIMIT 1`,
    )
    .get(id, chatJid, tool, value.toLowerCase(), now - VALUE_TTL_MS);
}

/**
 * Reserves one call (guard `limits`) and, for a write behind `confirmFirst`, the customer message
 * that confirmed it. Synchronous, so a parallel call of the same step sees it. Returns the row id
 * (removed again with `releaseCall` when the call is refused or fails).
 */
export function recordCall(
  db: DB,
  id: string,
  tool: string,
  chatJid: string | null,
  now: number,
  consentMessageId: string | null = null,
): number {
  return db.transaction(() => {
    // Plain counts last a day; a used consent is kept long enough never to be reused.
    db.prepare(
      'DELETE FROM connector_calls WHERE at < ? AND (consent_message_id IS NULL OR at < ?)',
    ).run(now - LIMIT_WINDOW_MS, now - CONSENT_TTL_MS);
    return Number(
      db
        .prepare(
          'INSERT INTO connector_calls (connector_id, tool, chat_jid, consent_message_id, at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, tool, chatJid, consentMessageId, now).lastInsertRowid,
    );
  })();
}

export function releaseCall(db: DB, rowId: number): void {
  db.prepare('DELETE FROM connector_calls WHERE id = ?').run(rowId);
}

/** True when this tool already ran in this chat on the consent of this customer message. */
export function consentUsed(
  db: DB,
  id: string,
  tool: string,
  chatJid: string,
  messageId: string,
): boolean {
  return !!db
    .prepare(
      'SELECT 1 FROM connector_calls WHERE connector_id = ? AND tool = ? AND chat_jid = ? AND consent_message_id = ? LIMIT 1',
    )
    .get(id, tool, chatJid, messageId);
}

/** The customer's latest message in this chat after `since` (the confirming message), or null. */
export function customerMessageSince(db: DB, chatJid: string, since: number): string | null {
  const row = db
    .prepare(
      `SELECT id FROM messages WHERE chat_jid = ? AND from_me = 0 AND timestamp > ?
       ORDER BY timestamp DESC, id DESC LIMIT 1`,
    )
    .get(chatJid, since) as { id: string } | undefined;
  return row?.id ?? null;
}

export function countCalls(
  db: DB,
  id: string,
  tool: string,
  chatJid: string | null,
  now: number,
): number {
  const since = now - LIMIT_WINDOW_MS;
  const row = (
    chatJid === null
      ? db
          .prepare(
            'SELECT COUNT(*) AS n FROM connector_calls WHERE connector_id = ? AND tool = ? AND at >= ?',
          )
          .get(id, tool, since)
      : db
          .prepare(
            'SELECT COUNT(*) AS n FROM connector_calls WHERE connector_id = ? AND tool = ? AND chat_jid = ? AND at >= ?',
          )
          .get(id, tool, chatJid, since)
  ) as { n: number };
  return row.n;
}

/** The time of the AI agent's latest reply in this chat, or null. */
export function lastAiReplyAt(db: DB, chatJid: string, aiUserId: number): number | null {
  const row = db
    .prepare(
      `SELECT MAX(timestamp) AS at FROM messages
       WHERE chat_jid = ? AND from_me = 1 AND sent_by_user_id = ?`,
    )
    .get(chatJid, aiUserId) as { at: number | null };
  return row.at;
}

/** chats/merge.ts: moves every connector row of chat `from` to `to` (inside its transaction). */
export function mergeConnectorRows(db: DB, from: string, to: string): number {
  return (
    db.prepare('UPDATE connector_activity SET chat_jid = ? WHERE chat_jid = ?').run(to, from)
      .changes +
    db.prepare('UPDATE connector_values SET chat_jid = ? WHERE chat_jid = ?').run(to, from)
      .changes +
    db.prepare('UPDATE connector_calls SET chat_jid = ? WHERE chat_jid = ?').run(to, from).changes
  );
}

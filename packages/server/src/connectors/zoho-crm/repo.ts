import {
  DEFAULT_ZOHO_CRM_SETTINGS,
  ZohoCrmAgentSettings,
  type ZohoCrmActivity,
  type ZohoCrmActivityKind,
  type ZohoCrmModule,
  type ZohoCrmNotAddedReason,
} from '@ezychat/shared';
import type { DB } from '../../db/index.js';

/** The only SQL of the Zoho CRM connector (migration 025). */

export const ACTIVITY_LIMIT = 50;

export function readSettings(db: DB, agentId: number): ZohoCrmAgentSettings {
  const row = db
    .prepare('SELECT settings FROM zoho_crm_agent_settings WHERE agent_id = ?')
    .get(agentId) as { settings: string } | undefined;
  if (!row) return { ...DEFAULT_ZOHO_CRM_SETTINGS };
  try {
    const parsed = ZohoCrmAgentSettings.safeParse(JSON.parse(row.settings));
    return parsed.success ? parsed.data : { ...DEFAULT_ZOHO_CRM_SETTINGS };
  } catch {
    return { ...DEFAULT_ZOHO_CRM_SETTINGS };
  }
}

export function writeSettings(
  db: DB,
  agentId: number,
  settings: ZohoCrmAgentSettings,
  now: number,
) {
  db.prepare(
    `INSERT INTO zoho_crm_agent_settings (agent_id, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
  ).run(agentId, JSON.stringify(settings), now);
}

export interface LeadRow {
  recordId: string;
  addedBy: 'ai' | 'team';
  request: string | null;
}

export function leadFor(db: DB, chatJid: string): LeadRow | null {
  const row = db
    .prepare(
      'SELECT record_id AS recordId, added_by AS addedBy, request FROM zoho_crm_leads WHERE chat_jid = ?',
    )
    .get(chatJid) as LeadRow | undefined;
  return row ?? null;
}

/** Records the lead EzyChat added for this chat; false when the chat already has one. */
export function insertLead(
  db: DB,
  row: {
    chatJid: string;
    recordId: string;
    addedBy: 'ai' | 'team';
    agentId: number | null;
    userId: number | null;
    request: string | null;
  },
  now: number,
): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO zoho_crm_leads (chat_jid, record_id, added_by, agent_id, user_id, request, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.chatJid, row.recordId, row.addedBy, row.agentId, row.userId, row.request, now)
      .changes > 0
  );
}

export function addActivity(
  db: DB,
  row: {
    kind: ZohoCrmActivityKind;
    agentId?: number | null;
    userId?: number | null;
    chatJid: string | null;
    module?: ZohoCrmModule | null;
    reason?: ZohoCrmNotAddedReason | null;
  },
  now: number,
) {
  db.prepare(
    'INSERT INTO zoho_crm_activity (kind, agent_id, user_id, chat_jid, module, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.kind,
    row.agentId ?? null,
    row.userId ?? null,
    row.chatJid,
    row.module ?? null,
    row.reason ?? null,
    now,
  );
}

interface ActivityRow {
  id: number;
  at: number;
  kind: ZohoCrmActivityKind;
  agentId: number | null;
  agentName: string | null;
  userName: string | null;
  chatJid: string | null;
  chatName: string | null;
  profileName: string | null;
  module: ZohoCrmModule | null;
  reason: ZohoCrmNotAddedReason | null;
}

/** Newest first, at most 50; names from the agent's or teammate's user row and the chat. */
export function listActivity(db: DB): ZohoCrmActivity[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.kind, a.agent_id AS agentId, au.display_name AS agentName,
              tu.display_name AS userName, a.chat_jid AS chatJid, c.name AS chatName,
              p.name AS profileName, a.module, a.reason
       FROM zoho_crm_activity a
       LEFT JOIN ai_agents g ON g.id = a.agent_id
       LEFT JOIN users au ON au.id = g.user_id
       LEFT JOIN users tu ON tu.id = a.user_id
       LEFT JOIN chats c ON c.jid = a.chat_jid
       LEFT JOIN customer_profiles p ON p.chat_jid = a.chat_jid
       ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    )
    .all(ACTIVITY_LIMIT) as ActivityRow[];
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    agentId: row.agentId,
    actorName: row.userName ?? row.agentName ?? '',
    chatJid: row.chatJid,
    customer: row.profileName?.trim() || row.chatName || '',
    module: row.module,
    reason: row.reason,
  }));
}

/** chats/merge.ts: moves every Zoho CRM row of chat `from` to `to` (inside its transaction). */
export function mergeZohoCrmRows(db: DB, from: string, to: string): number {
  let moved = db
    .prepare('UPDATE OR IGNORE zoho_crm_leads SET chat_jid = ? WHERE chat_jid = ?')
    .run(to, from).changes;
  // Both chats had a lead: `to` keeps its own.
  db.prepare('DELETE FROM zoho_crm_leads WHERE chat_jid = ?').run(from);
  moved += db
    .prepare('UPDATE zoho_crm_activity SET chat_jid = ? WHERE chat_jid = ?')
    .run(to, from).changes;
  return moved;
}

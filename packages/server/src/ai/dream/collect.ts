import {
  DREAM_MESSAGES_PER_CHAT,
  DREAM_REGRESSION_QUESTIONS,
  DREAM_TAKEOVERS_MAX,
  type AiHandoffReason,
} from '@ezychat/shared';
import type { AppContext } from '../../context.js';
import { inboxCustomerNames } from '../customer-names.js';
import { cleanTeamReply } from '../phrases/check.js';

/**
 * Reads the take-over chats dream mode learns from (design §3). Read only. Leaves out, before any text reaches a model:
 * forwarded messages (owner rule), deleted or hidden ones, scheduled-task messages, messages Safety flagged or has not
 * finished checking, system rows and media without a caption. Names, emails and long numbers are replaced.
 */
export interface TakeoverMessage {
  /** 1..n inside this chat; the only id a model sees. */
  localId: number;
  /** The stored message id (never sent to a model). */
  messageId: string;
  role: 'customer' | 'ai' | 'team';
  at: number;
  text: string;
}

export interface TakeoverChat {
  chatJid: string;
  kind: 'handoff' | 'reply_over_ai';
  handoffReason: AiHandoffReason | null;
  messages: TakeoverMessage[];
}

interface Window {
  agentId: number;
  from: number;
  to: number;
  limit?: number;
}

interface Trigger {
  jid: string;
  kind: TakeoverChat['kind'];
  reason: AiHandoffReason | null;
  at: number;
}

interface RawMessage {
  id: string;
  from_me: number;
  sent_by_user_id: number | null;
  kind: string | null;
  body: string;
  created_at: number;
}

const TEXT_CHARACTERS = 1_000;

/** Messages a model may read: shared by both readers below. */
const READABLE = `m.body IS NOT NULL AND TRIM(m.body) <> '' AND m.type <> 'system'
  AND COALESCE(m.forwarding_score, 0) = 0 AND m.deleted_at IS NULL AND m.hidden_at IS NULL
  AND m.scheduled_task_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM safety_items s WHERE s.message_id = m.id AND (s.level <> 'none' OR s.ai_level IS NULL))`;

function agentOf(ctx: AppContext, agentId: number) {
  return ctx.db
    .prepare('SELECT user_id AS userId, inbox_id AS inboxId FROM ai_agents WHERE id = ?')
    .get(agentId) as { userId: number; inboxId: number | null } | undefined;
}

/** The latest hand-off or reply over the AI in each direct chat of the agent's inbox, newest first. */
function triggers(
  ctx: AppContext,
  agentId: number,
  aiUserId: number,
  inboxId: number,
  w: Window,
): Trigger[] {
  const handoffs = ctx.db
    .prepare(
      `SELECT json_extract(meta, '$.chatJid') AS jid, json_extract(meta, '$.reason') AS reason, at FROM audit_log
        WHERE action = 'ai.handoff' AND json_extract(meta, '$.agentId') = ? AND at BETWEEN ? AND ?`,
    )
    .all(agentId, w.from, w.to) as { jid: string; reason: AiHandoffReason | null; at: number }[];
  const overs = ctx.db
    .prepare(
      `SELECT chat_jid AS jid, at FROM chat_events
        WHERE type = 'assigned' AND json_extract(payload, '$.reason') = 'reply'
          AND json_extract(payload, '$.previous') = ? AND at BETWEEN ? AND ?`,
    )
    .all(aiUserId, w.from, w.to) as { jid: string; at: number }[];
  const latest = new Map<string, Trigger>();
  for (const t of [
    ...handoffs.map((h) => ({
      jid: h.jid,
      kind: 'handoff' as const,
      reason: h.reason ?? null,
      at: h.at,
    })),
    ...overs.map((o) => ({ jid: o.jid, kind: 'reply_over_ai' as const, reason: null, at: o.at })),
  ])
    if ((latest.get(t.jid)?.at ?? -1) < t.at) latest.set(t.jid, t);
  const direct = ctx.db.prepare(
    "SELECT 1 FROM chats WHERE jid = ? AND type = 'dm' AND inbox_id = ?",
  );
  return [...latest.values()].filter((t) => direct.get(t.jid, inboxId)).sort((a, b) => b.at - a.at);
}

function roleOf(m: RawMessage, aiUserId: number): TakeoverMessage['role'] {
  if (!m.from_me) return 'customer';
  if (m.sent_by_user_id === null || m.kind === 'human') return 'team';
  return m.sent_by_user_id === aiUserId ? 'ai' : 'team';
}

export function collectTakeovers(ctx: AppContext, w: Window): TakeoverChat[] {
  const agent = agentOf(ctx, w.agentId);
  if (!agent || agent.inboxId === null) return [];
  const names = inboxCustomerNames(ctx.db, agent.inboxId);
  // The AI owns the chat again: replies after this no longer belong to the take-over.
  const backToAi = ctx.db.prepare(
    `SELECT MIN(at) AS at FROM chat_events WHERE chat_jid = ? AND type = 'assigned' AND at > ?
       AND json_extract(payload, '$.assignedTo') = ?`,
  );
  const messages = ctx.db.prepare(
    `SELECT m.id, m.from_me, m.sent_by_user_id, u.kind, m.body, m.created_at FROM messages m
       LEFT JOIN users u ON u.id = m.sent_by_user_id
      WHERE m.chat_jid = ? AND m.created_at <= ? AND ${READABLE}
      ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
  );
  const out: TakeoverChat[] = [];
  for (const t of triggers(ctx, w.agentId, agent.userId, agent.inboxId, w)) {
    if (out.length >= (w.limit ?? DREAM_TAKEOVERS_MAX)) break;
    const end = Math.min(
      w.to,
      (backToAi.get(t.jid, t.at, agent.userId) as { at: number | null }).at ?? w.to,
    );
    const rows = (messages.all(t.jid, end, 200) as RawMessage[]).map((m) => ({
      ...m,
      role: roleOf(m, agent.userId),
    }));
    const lastTeam = rows.find((m) => m.role === 'team' && m.created_at >= t.at);
    if (!lastTeam) continue;
    const kept = rows
      .filter((m) => m.created_at <= lastTeam.created_at)
      .slice(0, DREAM_MESSAGES_PER_CHAT)
      .reverse();
    out.push({
      chatJid: t.jid,
      kind: t.kind,
      handoffReason: t.reason,
      messages: kept.map((m, i) => ({
        localId: i + 1,
        messageId: m.id,
        role: m.role,
        at: m.created_at,
        text: cleanTeamReply(m.body, names).slice(0, TEXT_CHARACTERS).trim(),
      })),
    });
  }
  return out;
}

/** Customer questions the AI answered in the window with no hand-off or take-over (regression checks). */
export function questionsAnsweredByAi(ctx: AppContext, w: Window): string[] {
  const agent = agentOf(ctx, w.agentId);
  if (!agent || agent.inboxId === null) return [];
  const names = inboxCustomerNames(ctx.db, agent.inboxId);
  const taken = new Set(
    triggers(ctx, w.agentId, agent.userId, agent.inboxId, { ...w }).map((t) => t.jid),
  );
  const answers = ctx.db
    .prepare(
      `SELECT m.chat_jid AS jid, MAX(m.created_at) AS at FROM messages m JOIN chats c ON c.jid = m.chat_jid
        WHERE c.type = 'dm' AND c.inbox_id = ? AND m.from_me = 1 AND m.sent_by_user_id = ?
          AND m.created_at BETWEEN ? AND ? GROUP BY m.chat_jid ORDER BY at DESC`,
    )
    .all(agent.inboxId, agent.userId, w.from, w.to) as { jid: string; at: number }[];
  const question = ctx.db.prepare(
    `SELECT m.body FROM messages m WHERE m.chat_jid = ? AND m.from_me = 0 AND m.created_at <= ? AND ${READABLE}
      ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`,
  );
  const out: string[] = [];
  for (const a of answers) {
    if (out.length >= (w.limit ?? DREAM_REGRESSION_QUESTIONS)) break;
    if (taken.has(a.jid)) continue;
    const q = question.get(a.jid, a.at) as { body: string } | undefined;
    if (q) out.push(cleanTeamReply(q.body, names).slice(0, TEXT_CHARACTERS).trim());
  }
  return out;
}

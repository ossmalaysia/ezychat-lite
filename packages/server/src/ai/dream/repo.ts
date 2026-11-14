import {
  DREAM_DEFAULT_SETTINGS,
  DREAM_RUNS_SHOWN,
  DREAM_WAITING_TTL_MS,
  type DreamChange,
  type DreamChangeStatus,
  type DreamCheck,
  type DreamRun,
  type DreamRunReason,
  type DreamRunStatus,
  type DreamSettings,
  type DreamSettingsBody,
  type DreamTarget,
} from '@ezychat/shared';
import type { DB } from '../../db/index.js';

/** A change as the run saves it. */
export interface NewChange {
  target: DreamTarget;
  itemId: number | null;
  itemName: string | null;
  before: string;
  after: string;
  summary: string;
  sourceMessageIds: string[];
  checks: DreamCheck[];
  status: 'waiting' | 'applied';
  auto: boolean;
  versionId: number | null;
  createdAt: number;
}

export interface ChangeRow extends DreamChange {
  agentId: number;
  before: string;
  after: string;
  sourceMessageIds: string[];
  checks: DreamCheck[];
  versionId: number | null;
  decidedBy: number | null;
}

export interface RunResult {
  status: Exclude<DreamRunStatus, 'running'>;
  reason: DreamRunReason;
  chatsRead: number;
  takeovers: number;
  saved: number;
  dropped: number;
}

interface RawChange {
  id: number;
  run_id: number;
  agent_id: number;
  target: DreamTarget;
  item_id: number | null;
  item_name: string | null;
  before: string;
  after: string;
  summary: string;
  source_message_ids: string;
  checks: string;
  status: DreamChangeStatus;
  auto: number;
  version_id: number | null;
  decided_by: number | null;
  created_at: number;
  decided_at: number | null;
}

interface RawRun {
  id: number;
  slot: number;
  status: DreamRunStatus;
  reason: DreamRunReason;
  chats_read: number;
  takeovers: number;
  saved: number;
  dropped: number;
}

const toChange = (r: RawChange): ChangeRow => {
  const sourceMessageIds = JSON.parse(r.source_message_ids) as string[];
  return {
    id: r.id,
    runId: r.run_id,
    agentId: r.agent_id,
    target: r.target,
    itemId: r.item_id,
    itemName: r.item_name,
    summary: r.summary,
    status: r.status,
    auto: r.auto === 1,
    sourceCount: sourceMessageIds.length,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    before: r.before,
    after: r.after,
    sourceMessageIds,
    checks: JSON.parse(r.checks) as DreamCheck[],
    versionId: r.version_id,
    decidedBy: r.decided_by,
  };
};

/** Public view of a change (no setup text, no message ids). */
export const changeView = (c: ChangeRow): DreamChange => ({
  id: c.id,
  runId: c.runId,
  target: c.target,
  itemId: c.itemId,
  itemName: c.itemName,
  summary: c.summary,
  status: c.status,
  auto: c.auto,
  sourceCount: c.sourceCount,
  createdAt: c.createdAt,
  decidedAt: c.decidedAt,
});

/** The only SQL for the dream mode tables. */
export class DreamRepo {
  constructor(private readonly db: DB) {}

  settings(agentId: number): DreamSettings {
    const row = this.db
      .prepare('SELECT enabled, run_time, auto_apply FROM ai_dream_settings WHERE agent_id = ?')
      .get(agentId) as { enabled: number; run_time: string; auto_apply: number } | undefined;
    return row
      ? { enabled: row.enabled === 1, runTime: row.run_time, autoApply: row.auto_apply === 1 }
      : { ...DREAM_DEFAULT_SETTINGS };
  }

  saveSettings(
    agentId: number,
    body: DreamSettingsBody,
    now: number,
  ): { before: DreamSettings; after: DreamSettings } {
    const before = this.settings(agentId);
    const after = { ...before, ...body };
    this.db
      .prepare(
        `INSERT INTO ai_dream_settings (agent_id, enabled, run_time, auto_apply, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET enabled = excluded.enabled, run_time = excluded.run_time,
           auto_apply = excluded.auto_apply, updated_at = excluded.updated_at`,
      )
      .run(agentId, after.enabled ? 1 : 0, after.runTime, after.autoApply ? 1 : 0, now);
    return { before, after };
  }

  /** Agents with dream mode on, with when their settings last changed (a night set up after it does not run). */
  enabledAgents(): { agentId: number; runTime: string; autoApply: boolean; updatedAt: number }[] {
    return (
      this.db
        .prepare(
          'SELECT agent_id, run_time, auto_apply, updated_at FROM ai_dream_settings WHERE enabled = 1 ORDER BY agent_id',
        )
        .all() as { agent_id: number; run_time: string; auto_apply: number; updated_at: number }[]
    ).map((r) => ({
      agentId: r.agent_id,
      runTime: r.run_time,
      autoApply: r.auto_apply === 1,
      updatedAt: r.updated_at,
    }));
  }

  /** Inserts the night's run as `running` unless the slot has one; null = already claimed. */
  claimRun(agentId: number, slot: number, now: number): number | null {
    const info = this.db
      .prepare(
        "INSERT OR IGNORE INTO ai_dream_runs (agent_id, slot, status, started_at) VALUES (?, ?, 'running', ?)",
      )
      .run(agentId, slot, now);
    return info.changes ? Number(info.lastInsertRowid) : null;
  }

  finishRun(runId: number, r: RunResult, now: number): void {
    this.db
      .prepare(
        `UPDATE ai_dream_runs SET status = ?, reason = ?, chats_read = ?, takeovers = ?, saved = ?, dropped = ?,
           finished_at = ? WHERE id = ?`,
      )
      .run(r.status, r.reason, r.chatsRead, r.takeovers, r.saved, r.dropped, now, runId);
  }

  /** When the agent's last finished run ended (its next window starts there). */
  lastFinishedAt(agentId: number): number | null {
    const row = this.db
      .prepare(
        "SELECT MAX(finished_at) AS at FROM ai_dream_runs WHERE agent_id = ? AND status = 'done'",
      )
      .get(agentId) as { at: number | null };
    return row.at;
  }

  addChange(runId: number, agentId: number, c: NewChange): number {
    return Number(
      this.db
        .prepare(
          `INSERT INTO ai_dream_changes (run_id, agent_id, target, item_id, item_name, before, after, summary,
             source_message_ids, checks, status, auto, version_id, created_at, decided_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          agentId,
          c.target,
          c.itemId,
          c.itemName,
          c.before,
          c.after,
          c.summary,
          JSON.stringify(c.sourceMessageIds),
          JSON.stringify(c.checks),
          c.status,
          c.auto ? 1 : 0,
          c.versionId,
          c.createdAt,
          c.status === 'applied' ? c.createdAt : null,
        ).lastInsertRowid,
    );
  }

  change(id: number): ChangeRow | null {
    const row = this.db.prepare('SELECT * FROM ai_dream_changes WHERE id = ?').get(id) as
      RawChange | undefined;
    return row ? toChange(row) : null;
  }

  setStatus(
    id: number,
    status: DreamChangeStatus,
    opts: { versionId?: number | null; decidedBy?: number | null; now: number },
  ): void {
    this.db
      .prepare(
        `UPDATE ai_dream_changes SET status = ?, version_id = COALESCE(?, version_id), decided_by = ?,
           decided_at = ? WHERE id = ?`,
      )
      .run(status, opts.versionId ?? null, opts.decidedBy ?? null, opts.now, id);
  }

  history(
    agentId: number,
    before: number | null,
    limit = DREAM_RUNS_SHOWN,
  ): { runs: DreamRun[]; nextBefore: number | null } {
    const rows = this.db
      .prepare(
        `SELECT id, slot, status, reason, chats_read, takeovers, saved, dropped FROM ai_dream_runs
          WHERE agent_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
      )
      .all(agentId, before, before, limit + 1) as RawRun[];
    const page = rows.slice(0, limit);
    const changes = page.length
      ? (this.db
          .prepare(
            `SELECT * FROM ai_dream_changes WHERE run_id IN (${page.map(() => '?').join(',')}) ORDER BY id`,
          )
          .all(...page.map((r) => r.id)) as RawChange[])
      : [];
    const runs = page.map((r) => ({
      id: r.id,
      slot: r.slot,
      status: r.status,
      reason: r.reason,
      chatsRead: r.chats_read,
      takeovers: r.takeovers,
      saved: r.saved,
      dropped: r.dropped,
      changes: changes.filter((c) => c.run_id === r.id).map((c) => changeView(toChange(c))),
    }));
    return { runs, nextBefore: rows.length > limit ? page[page.length - 1]!.id : null };
  }

  /** Waiting changes older than 14 days become `expired`. */
  expireWaiting(now: number): void {
    this.db
      .prepare(
        "UPDATE ai_dream_changes SET status = 'expired', decided_at = ? WHERE status = 'waiting' AND created_at < ?",
      )
      .run(now, now - DREAM_WAITING_TTL_MS);
  }
}

import type { DB } from '../db/index.js';

/** The AI Sales Agent texts that keep a version history. */
export type SetupTarget = 'instructions' | 'handoff_rules' | 'context_text';

/** How a change was made: in the app, by an AI assistant over MCP, or the text it replaced. */
export type SetupVia = 'app' | 'mcp' | 'baseline';

export interface SetupChangeSource {
  userId: number | null;
  via: 'app' | 'mcp';
  /** MCP access token that made the change. */
  tokenId?: number | null;
  /** Why the assistant made the change (MCP requires one). */
  reason?: string | null;
}

export interface SetupVersion {
  id: number;
  target: SetupTarget;
  itemId: number | null;
  content: string;
  via: SetupVia;
  userId: number | null;
  tokenId: number | null;
  reason: string | null;
  createdAt: number;
}

interface Row {
  id: number;
  target: SetupTarget;
  item_id: number | null;
  content: string;
  via: SetupVia;
  user_id: number | null;
  token_id: number | null;
  reason: string | null;
  created_at: number;
}

const toVersion = (r: Row): SetupVersion => ({
  id: r.id,
  target: r.target,
  itemId: r.item_id,
  content: r.content,
  via: r.via,
  userId: r.user_id,
  tokenId: r.token_id,
  reason: r.reason,
  createdAt: r.created_at,
});

/**
 * Records a new saved text. The first change of a target also stores the text it replaced, so the
 * original can always be restored. Call inside the transaction that saves the text.
 */
export function recordSetupVersion(
  db: DB,
  target: SetupTarget,
  itemId: number | null,
  previous: string | null,
  next: string,
  source: SetupChangeSource,
  now = Date.now(),
): void {
  const insert = db.prepare(
    `INSERT INTO ai_setup_versions (target, item_id, content, via, user_id, token_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const hasHistory = db
    .prepare('SELECT 1 FROM ai_setup_versions WHERE target = ? AND item_id IS ? LIMIT 1')
    .get(target, itemId);
  if (!hasHistory && previous !== null && previous !== next) {
    insert.run(target, itemId, previous, 'baseline', null, null, null, now - 1);
  }
  insert.run(
    target,
    itemId,
    next,
    source.via,
    source.userId,
    source.tokenId ?? null,
    source.reason ?? null,
    now,
  );
}

/** Newest first. */
export function listSetupVersions(
  db: DB,
  target: SetupTarget,
  itemId: number | null,
  limit: number,
): SetupVersion[] {
  return (
    db
      .prepare(
        'SELECT * FROM ai_setup_versions WHERE target = ? AND item_id IS ? ORDER BY id DESC LIMIT ?',
      )
      .all(target, itemId, limit) as Row[]
  ).map(toVersion);
}

export function getSetupVersion(db: DB, id: number): SetupVersion | null {
  const row = db.prepare('SELECT * FROM ai_setup_versions WHERE id = ?').get(id) as Row | undefined;
  return row ? toVersion(row) : null;
}

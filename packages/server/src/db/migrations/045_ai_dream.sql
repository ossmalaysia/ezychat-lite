-- Dream mode (docs/superpowers/specs/2026-11-14-dream-mode-design.md): each night an AI agent reads its
-- inbox's take-over chats and saves checked setup changes. Adds tables only.

-- One row per agent that has opened dream mode; missing row = off, 02:00, Apply by itself off.
CREATE TABLE ai_dream_settings (
  agent_id INTEGER PRIMARY KEY REFERENCES ai_agents(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  -- HH:MM in the business time zone (ai_timezone), every day.
  run_time TEXT NOT NULL DEFAULT '02:00',
  auto_apply INTEGER NOT NULL DEFAULT 0 CHECK (auto_apply IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- One row per night (slot), inserted before the run, so a night runs at most once. Counts only, never text.
CREATE TABLE ai_dream_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'skipped', 'missed', 'failed')),
  reason TEXT,
  chats_read INTEGER NOT NULL DEFAULT 0,
  takeovers INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  dropped INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE UNIQUE INDEX idx_ai_dream_runs_slot ON ai_dream_runs(agent_id, slot);

-- Changes that passed every check (a failing one is never stored). Holds setup text and stored message
-- ids only; the team's words are read live from messages when an admin opens the change.
CREATE TABLE ai_dream_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_dream_runs(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('context_text', 'instructions', 'handoff_rules')),
  item_id INTEGER,
  item_name TEXT,
  before TEXT NOT NULL,
  after TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_message_ids TEXT NOT NULL,
  checks TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'applied', 'dismissed', 'undone', 'stale', 'expired')),
  auto INTEGER NOT NULL DEFAULT 0 CHECK (auto IN (0, 1)),
  version_id INTEGER,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX idx_ai_dream_changes_run ON ai_dream_changes(run_id);
CREATE INDEX idx_ai_dream_changes_agent ON ai_dream_changes(agent_id, status);

-- The team's phrase list for instant grey text (docs/features/ai-phrase-dictionary/design.md): one
-- list per AI agent, built by the AI in the background and edited by admins. `uses` counts Tab /
-- Accept minus Esc; `fact` marks a phrase with a number, checked against the business context.
CREATE TABLE reply_phrases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('en', 'ms', 'zh')),
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('context', 'team', 'admin')),
  uses INTEGER NOT NULL DEFAULT 0,
  fact INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_reply_phrases_agent ON reply_phrases(agent_id, uses DESC, id DESC);

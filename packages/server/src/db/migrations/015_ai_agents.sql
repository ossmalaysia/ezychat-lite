-- Custom AI agents: the one AI Sales Agent becomes agent 1 of N. Several `kind = 'ai'` users are
-- possible now (the role triggers of 003 stay). Name and on/off stay on the users row
-- (display_name, disabled_at). An agent serves at most one inbox and an inbox has at most one agent;
-- inbox_id NULL = serves no inbox. instructions / handoff_rules NULL = never saved (the preset's
-- defaults); a saved blank stays blank. The texts saved in the `ai_sales_member` setting are copied
-- into agent 1 by a permanent start-up step (ai/agents.ts migrateMemberSetting).
DROP INDEX IF EXISTS idx_single_ai_member;

-- A deleted agent keeps its user row for message history, disabled and hidden.
ALTER TABLE users ADD COLUMN ai_deleted_at INTEGER;

CREATE TABLE ai_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  inbox_id INTEGER UNIQUE REFERENCES inboxes(id),
  preset TEXT NOT NULL DEFAULT 'sales' CHECK (preset IN ('sales', 'faq', 'custom')),
  instructions TEXT,
  handoff_rules TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The AI member of today serves inbox 1 (the number linked before multi-inbox).
INSERT INTO ai_agents (user_id, inbox_id, preset, instructions, handoff_rules, created_at, updated_at)
SELECT id, 1, 'sales', NULL, NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM users WHERE kind = 'ai' ORDER BY id LIMIT 1;

-- Business context items belong to one agent; Internal items inform the agent and are never quoted.
ALTER TABLE ai_documents ADD COLUMN agent_id INTEGER REFERENCES ai_agents(id) ON DELETE CASCADE;
ALTER TABLE ai_documents ADD COLUMN internal INTEGER NOT NULL DEFAULT 0;
UPDATE ai_documents SET agent_id = (SELECT id FROM ai_agents ORDER BY id LIMIT 1)
WHERE agent_id IS NULL;
DROP INDEX IF EXISTS idx_ai_documents_order;
CREATE INDEX idx_ai_documents_agent ON ai_documents(agent_id, created_at, id);

-- The version history is kept per agent (no foreign key: history outlives a deleted agent).
ALTER TABLE ai_setup_versions ADD COLUMN agent_id INTEGER;
UPDATE ai_setup_versions SET agent_id = (SELECT id FROM ai_agents ORDER BY id LIMIT 1)
WHERE agent_id IS NULL;
DROP INDEX IF EXISTS idx_ai_setup_versions_target;
CREATE INDEX idx_ai_setup_versions_agent ON ai_setup_versions(agent_id, target, item_id, id);

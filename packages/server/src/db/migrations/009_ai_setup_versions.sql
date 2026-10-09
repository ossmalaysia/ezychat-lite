-- Saved versions of the AI Sales Agent's setup texts, from the app and from AI assistants over MCP,
-- so a change can be reviewed and reverted. `target` is 'instructions', 'handoff_rules' or
-- 'context_text' (a Business context text item, `item_id` = ai_documents.id). The first change of a
-- target also stores the text it replaced ('baseline'). `token_id` names the MCP access token.
CREATE TABLE ai_setup_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  item_id INTEGER,
  content TEXT NOT NULL,
  via TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_id INTEGER REFERENCES api_tokens(id) ON DELETE SET NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_setup_versions_target ON ai_setup_versions(target, item_id, id);

-- Every admin token may read, test and change the AI Sales Agent setup (owner decision).
UPDATE api_tokens SET scopes = 'inbox:read ai:setup' WHERE scopes = 'inbox:read';

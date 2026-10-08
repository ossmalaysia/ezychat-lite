-- Personal access tokens for AI assistants (MCP). Only the SHA-256 hash of the secret is stored; `prefix`
-- is the first characters of the secret, for recognising a token in the list. `scopes` is a
-- space-separated list (v1 only grants `inbox:read`). Revoked rows are kept for the audit trail.
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'inbox:read',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

-- Inbox statistics scan messages by time across all chats.
CREATE INDEX idx_messages_ts ON messages(timestamp);

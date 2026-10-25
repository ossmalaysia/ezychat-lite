-- AI assistant apps (claude.ai, ChatGPT, …) that registered themselves for the MCP sign-in (OAuth
-- dynamic client registration). `id` is the client_id we issued; `redirect_uris` is a JSON array;
-- `secret_hash` is the SHA-256 of the client secret, only for the `client_secret_*` methods.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  secret_hash TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- The app an approved sign-in issued the token to (NULL for tokens made in Settings).
ALTER TABLE api_tokens ADD COLUMN oauth_client_id TEXT;

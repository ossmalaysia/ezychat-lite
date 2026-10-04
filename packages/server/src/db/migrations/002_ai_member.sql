ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'ai'));
CREATE UNIQUE INDEX idx_single_ai_member ON users(kind) WHERE kind = 'ai';
CREATE TRIGGER ai_member_role_insert BEFORE INSERT ON users
WHEN NEW.kind = 'ai' AND NEW.role != 'agent'
BEGIN SELECT RAISE(ABORT, 'AI members must be agents'); END;
CREATE TRIGGER ai_member_role_update BEFORE UPDATE OF kind, role ON users
WHEN NEW.kind = 'ai' AND NEW.role != 'agent'
BEGIN SELECT RAISE(ABORT, 'AI members must be agents'); END;

CREATE TABLE ai_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- A handoff pauses automatic fallback until a human replies/resolves, or explicitly assigns AI.
CREATE TABLE ai_chat_state (
  chat_jid TEXT PRIMARY KEY REFERENCES chats(jid) ON DELETE CASCADE,
  paused INTEGER NOT NULL DEFAULT 0,
  awaiting_confirmation INTEGER NOT NULL DEFAULT 0,
  last_customer_message_id TEXT,
  last_replied_message_id TEXT,
  due_at INTEGER
);

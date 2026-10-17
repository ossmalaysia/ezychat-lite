-- Adds the 'ai_tool_used' chat event ("AI looked up …" line). SQLite cannot change a CHECK
-- constraint in place, so the table is rebuilt with the same columns, ids and index.
CREATE TABLE chat_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('assigned', 'unassigned', 'resolved', 'reopened', 'ai_tool_used')),
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  at INTEGER NOT NULL
);
INSERT INTO chat_events_new (id, chat_jid, type, actor_id, payload, at)
  SELECT id, chat_jid, type, actor_id, payload, at FROM chat_events;
DROP TABLE chat_events;
ALTER TABLE chat_events_new RENAME TO chat_events;
CREATE INDEX idx_chat_events_chat ON chat_events(chat_jid, at);

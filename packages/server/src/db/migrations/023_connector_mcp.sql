-- Partner (MCP) connections from the connector list (docs/features/connector-list/design.md).
-- Secrets (keys, secret fields, OAuth tokens) are one AES-GCM blob per connection (the settings
-- secret box); never in a plain column. Chat keys carry no foreign key (user data never cascades
-- with a chat); chats/merge.ts moves them.

-- One row per list connector that was ever connected. `entry_json` is the list entry as it was at
-- connect time (a connector removed from the list keeps working with it); `tools_json` the partner's
-- tools as last listed (name, bounded input schema, read-only hint).
CREATE TABLE connector_connections (
  connector_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('connected', 'needs_sign_in', 'unreachable', 'disconnected')),
  entry_json TEXT NOT NULL,
  secret TEXT,
  account TEXT,
  key_end TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  tools_json TEXT NOT NULL DEFAULT '[]',
  connected_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- What each AI agent may do with a connector: the entry's settings form and one switch per tool.
CREATE TABLE connector_agent_settings (
  connector_id TEXT NOT NULL,
  agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  tools_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connector_id, agent_id)
);

-- The connector's Activity tab: who, which tool and the outcome; never arguments or chat text.
CREATE TABLE connector_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checked', 'done', 'refused', 'failed')),
  agent_id INTEGER,
  chat_jid TEXT,
  tool TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX idx_connector_activity ON connector_activity(connector_id, at DESC, id DESC);
CREATE INDEX idx_connector_activity_chat ON connector_activity(chat_jid);

-- Values a read tool returned in a chat (guard `valueFrom`), kept 24 hours.
CREATE TABLE connector_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  tool TEXT NOT NULL,
  value TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_connector_values ON connector_values(connector_id, chat_jid, tool, value);
CREATE INDEX idx_connector_values_at ON connector_values(at);
CREATE INDEX idx_connector_values_chat ON connector_values(chat_jid);

-- Calls that ran (guard `limits`: per chat and per day), reserved before the partner call. A write
-- behind `confirmFirst` keeps the customer message that confirmed it: one consent, one change.
CREATE TABLE connector_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  chat_jid TEXT,
  consent_message_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX idx_connector_calls ON connector_calls(connector_id, tool, at);
CREATE INDEX idx_connector_calls_chat ON connector_calls(chat_jid);

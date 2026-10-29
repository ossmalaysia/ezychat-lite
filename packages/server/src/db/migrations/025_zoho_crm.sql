-- Zoho CRM connector (docs/features/zoho-crm/design.md). The Zoho sign-in itself lives in encrypted
-- settings; these tables hold what each AI agent may do and what it did. Chat keys carry no foreign
-- key (user data never cascades with a chat); chats/merge.ts moves them.

-- Settings per AI agent (JSON of ZohoCrmAgentSettings).
CREATE TABLE zoho_crm_agent_settings (
  agent_id INTEGER PRIMARY KEY REFERENCES ai_agents(id) ON DELETE CASCADE,
  settings TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Leads EzyChat added: one per chat (the AI or a teammate), with the request summary it wrote.
CREATE TABLE zoho_crm_leads (
  chat_jid TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  added_by TEXT NOT NULL CHECK (added_by IN ('ai', 'team')),
  agent_id INTEGER,
  user_id INTEGER,
  request TEXT,
  created_at INTEGER NOT NULL
);

-- The connector's Activity tab: who and when, never chat text.
CREATE TABLE zoho_crm_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('found', 'not_found', 'added', 'added_by_team', 'not_added', 'failed')),
  agent_id INTEGER,
  user_id INTEGER,
  chat_jid TEXT,
  module TEXT CHECK (module IN ('Contacts', 'Leads')),
  reason TEXT CHECK (reason IN ('exists', 'no_name', 'unavailable')),
  at INTEGER NOT NULL
);
CREATE INDEX idx_zoho_crm_activity_at ON zoho_crm_activity(at DESC, id DESC);

-- AI agents in WhatsApp groups (docs/features/ai-groups/design.md). An agent answers in a group only
-- when its "Answer in groups" switch is on (default off: nothing changes for existing installs) and
-- an admin switched that group on. Group chats are never merged, so the chat key needs no merge
-- step; like other chat-keyed user data it has no foreign key to `chats`.
ALTER TABLE ai_agents ADD COLUMN answer_groups INTEGER NOT NULL DEFAULT 0 CHECK (answer_groups IN (0, 1));

CREATE TABLE ai_group_chats (
  chat_jid TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);

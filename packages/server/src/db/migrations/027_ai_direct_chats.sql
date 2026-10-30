-- AI agent "Answer direct chats" (docs/features/ai-direct-chats/design.md). Off with "Answer in
-- groups" on makes a group-only agent. Default on: nothing changes for existing installs.
ALTER TABLE ai_agents ADD COLUMN answer_direct INTEGER NOT NULL DEFAULT 1 CHECK (answer_direct IN (0, 1));

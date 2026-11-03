-- Several AI agents per WhatsApp number (docs/features/group-agents/design.md, Part B). A group is
-- answered by the agent its row names (NULL = none); "Reads every message" (`listen`) makes every
-- live member message start a turn of that agent (default off: tags and quotes only, as before).
ALTER TABLE ai_group_chats ADD COLUMN agent_id INTEGER;
ALTER TABLE ai_group_chats ADD COLUMN listen INTEGER NOT NULL DEFAULT 0 CHECK (listen IN (0, 1));

-- Existing switched-on groups keep the agent of their inbox (until now the only one). The inbox is
-- read from the chat key: inbox 1 has none, other inboxes end in `#<id>` (inboxes/keys.ts).
UPDATE ai_group_chats SET agent_id = (
  SELECT a.id FROM ai_agents a
  WHERE a.inbox_id = CASE WHEN instr(ai_group_chats.chat_jid, '#') > 0
    THEN CAST(substr(ai_group_chats.chat_jid, instr(ai_group_chats.chat_jid, '#') + 1) AS INTEGER)
    ELSE 1 END
  ORDER BY a.id LIMIT 1
) WHERE enabled = 1;

CREATE INDEX ai_group_chats_agent ON ai_group_chats(agent_id);

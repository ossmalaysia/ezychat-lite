-- AI in groups: Open chat, all groups and per-group choices (docs/features/ai-groups-open-chat/design.md).
-- Each agent answers in all groups of its inbox (new ones too) or the selected ones only, with a default
-- mode (Tag and quote or Open chat); each group can use the default, a mode of its own, or Off. Existing
-- agents keep what they did: selected groups only, Tag and quote. A switched-on group becomes "default"
-- (the agent's mode, Tag and quote), a switched-off one "off". `enabled` stays in step for old readers.
ALTER TABLE ai_agents ADD COLUMN group_scope TEXT NOT NULL DEFAULT 'selected'
  CHECK (group_scope IN ('all', 'selected'));
ALTER TABLE ai_agents ADD COLUMN group_mode TEXT NOT NULL DEFAULT 'tag'
  CHECK (group_mode IN ('tag', 'open'));

ALTER TABLE ai_group_chats ADD COLUMN setting TEXT NOT NULL DEFAULT 'off'
  CHECK (setting IN ('default', 'open', 'tag', 'off'));
UPDATE ai_group_chats SET setting = CASE enabled WHEN 1 THEN 'default' ELSE 'off' END;

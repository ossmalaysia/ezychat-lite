-- "Ask if the question is answered" per AI agent (docs/backlog.md, hand-off rules fixes). On, the
-- agent ends an answer with a resolution question and may close the chat on a clear "yes"; off, it
-- never adds a check-in line and never closes a chat (the team does). Off for sales agents: a
-- check-in line after every answer, and a "yes" to another question read as "resolved", lost leads.
-- Other presets keep today's behaviour.
ALTER TABLE ai_agents ADD COLUMN resolution_check INTEGER NOT NULL DEFAULT 0 CHECK (resolution_check IN (0, 1));
UPDATE ai_agents SET resolution_check = 1 WHERE preset <> 'sales';

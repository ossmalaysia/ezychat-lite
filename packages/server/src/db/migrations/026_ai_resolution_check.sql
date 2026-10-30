-- "Ask if the question is answered" per AI agent (docs/features/ai-handoff-rules/design.md). On, the
-- agent ends an answer with a resolution question and may close the chat on a clear "yes"; off, it
-- never adds a check-in line and never closes a chat (the team does). Off for every agent, existing
-- ones included (owner, 2026-10-30): a check-in line after every answer, and a "yes" to another
-- question read as "resolved", lost leads. An admin switches it on per agent.
ALTER TABLE ai_agents ADD COLUMN resolution_check INTEGER NOT NULL DEFAULT 0 CHECK (resolution_check IN (0, 1));

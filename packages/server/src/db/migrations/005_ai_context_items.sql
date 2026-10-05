-- Business context items: every AI document is an uploaded file or text content added in the app.
ALTER TABLE ai_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'text'));
ALTER TABLE ai_documents ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE ai_documents SET updated_at = created_at;
-- Knowledge is assembled oldest first (created_at, id) so the cached prompt prefix stays stable.
CREATE INDEX idx_ai_documents_order ON ai_documents(created_at, id);

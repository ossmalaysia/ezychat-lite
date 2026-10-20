-- Outgoing messages an AI assistant sent through MCP (send_message, send_to_new_number): the access
-- token's id, so the inbox shows "via AI assistant". No foreign key: a revoked token keeps its row.
ALTER TABLE messages ADD COLUMN sent_via_token_id INTEGER;

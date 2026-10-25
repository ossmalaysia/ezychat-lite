-- Inbox connection types: `linked_phone` (the WhatsApp app on a phone, QR scan) or a type an
-- edition's extension registers (e.g. the WhatsApp Business API). Existing inboxes are phones.
ALTER TABLE inboxes ADD COLUMN type TEXT NOT NULL DEFAULT 'linked_phone';

-- When the customer last wrote (epoch ms): the start of a Business API reply window. Set by ingest
-- for live inbound messages; existing chats start from their newest inbound message.
ALTER TABLE chats ADD COLUMN last_inbound_at INTEGER;
UPDATE chats SET last_inbound_at = (
  SELECT MAX(m.timestamp) FROM messages m WHERE m.chat_jid = chats.jid AND m.from_me = 0
);

-- A message sent as an approved template: its name, language and body values (JSON array, kept so
-- a queued send survives a restart or a retry). NULL for every other message.
ALTER TABLE messages ADD COLUMN template_name TEXT;
ALTER TABLE messages ADD COLUMN template_language TEXT;
ALTER TABLE messages ADD COLUMN template_params TEXT;

-- Delete chat (docs/features/chat-hide-delete/design.md Part B): one tombstone per chat an admin deleted, keyed
-- like the chat (inbox and the customer's or group's WhatsApp JID, never the internal key). WhatsApp's history sync
-- never brings the chat back or re-imports messages older than deleted_at; a live message starts a new chat. A later
-- delete of the same chat moves deleted_at. Holds no name, number of messages or text.
CREATE TABLE deleted_chats (
  inbox_id INTEGER NOT NULL,
  wa_jid TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (inbox_id, wa_jid)
);

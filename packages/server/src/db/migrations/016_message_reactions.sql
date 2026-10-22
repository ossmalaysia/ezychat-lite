-- Emoji reactions to messages, one row per reacted message and person (WhatsApp keeps one reaction
-- per person: a new emoji replaces the row, a removal deletes it). message_id is the stored message
-- key of the reacted message (`<waId>` for inbox 1, `<waId>#<inboxId>` otherwise) and has no
-- foreign key: a reaction that arrives before its message (history order, an echo not yet renamed)
-- waits here and shows once the message is stored. reactor is 'me' for the linked number, else the
-- reactor's identity as the alias store resolves it (the LID once known). chat_wa_jid is the chat
-- WhatsApp delivered the reaction in: a reaction shows only on a message of that same chat.
CREATE TABLE message_reactions (
  message_id TEXT NOT NULL,
  reactor TEXT NOT NULL,
  chat_wa_jid TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sender_jid TEXT,
  sender_name TEXT,
  from_me INTEGER NOT NULL DEFAULT 0,
  reacted_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, reactor)
) WITHOUT ROWID;

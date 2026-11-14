-- Hide chats on Log out (docs/features/chat-hide-delete/design.md Part A). When a linked phone logs out (the admin's
-- Log out or an unlink from the phone), every chat of that inbox gets hidden_at (epoch ms) and hidden_number (the
-- digits of the inbox's own number at that moment). A hidden chat behaves like a chat that does not exist; nothing is
-- deleted. The same number linking again shows a chat again when WhatsApp reports it (both columns back to NULL); a
-- different number archives the hidden chats under a `~old<n>` key, and they stay hidden for good.
ALTER TABLE chats ADD COLUMN hidden_at INTEGER;
ALTER TABLE chats ADD COLUMN hidden_number TEXT;
-- Small partial index: readers leave hidden chats out with `NOT IN (SELECT jid FROM chats WHERE hidden_at IS NOT NULL)`.
CREATE INDEX idx_chats_hidden ON chats(inbox_id) WHERE hidden_at IS NOT NULL;

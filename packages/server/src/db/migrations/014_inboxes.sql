-- Multi-inbox: one row per linked WhatsApp number. Inbox 1 is the number linked before this
-- migration: its Baileys files stay in wa-auth/ and its chat keys stay the plain WhatsApp JID.
-- Other inboxes keep their files in wa-auth-inboxes/<id>/ and key their chats `<waJid>#<id>`.
CREATE TABLE inboxes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('primary', 'warning', 'info', 'success')),
  auth_dir TEXT NOT NULL UNIQUE,
  own_jid TEXT,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);
INSERT INTO inboxes (id, name, tone, auth_dir, own_jid, created_at, removed_at)
VALUES (1, 'WhatsApp', 'primary', 'wa-auth', NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL);

-- Agents who may open an inbox (admins and the AI member open every inbox).
CREATE TABLE inbox_members (
  inbox_id INTEGER NOT NULL REFERENCES inboxes(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (inbox_id, user_id)
);
CREATE INDEX idx_inbox_members_user ON inbox_members(user_id);
-- Every existing agent keeps the one inbox they could open before.
INSERT INTO inbox_members (inbox_id, user_id)
SELECT 1, id FROM users WHERE role = 'agent' AND kind = 'human';

ALTER TABLE chats ADD COLUMN inbox_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chats ADD COLUMN wa_jid TEXT;
UPDATE chats SET wa_jid = jid WHERE wa_jid IS NULL;
CREATE UNIQUE INDEX idx_chats_inbox_wa ON chats(inbox_id, wa_jid);
CREATE INDEX idx_chats_inbox_last ON chats(inbox_id, last_message_at DESC);

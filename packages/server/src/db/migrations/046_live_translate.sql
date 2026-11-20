-- Live translate (docs/features/live-translate/design.md, docs/live-translate.md): each teammate reads
-- and writes in My language; replies go out in the customer's language. Adds tables and two user
-- columns only. Translation rows are deleted with their message or chat (chats/delete.ts DELETE_PLAN).

-- A translation cache: one row per message, revision (its edited_at, 0 = never edited) and target.
-- status 'ok' (text shown), 'unsafe' (a protected item changed: never shown) or 'same' (already in
-- the target language).
CREATE TABLE message_translations (
  message_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  target TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'unsafe', 'same')),
  model TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, revision, target)
);

-- What the teammate typed before a reply was translated (the message row is what WhatsApp got).
CREATE TABLE message_typed (
  message_id TEXT PRIMARY KEY,
  user_id INTEGER,
  typed_text TEXT NOT NULL,
  typed_lang TEXT NOT NULL,
  sent_lang TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  sent_original INTEGER NOT NULL DEFAULT 0 CHECK (sent_original IN (0, 1)),
  created_at INTEGER NOT NULL
);

-- The customer's (and a group's outgoing) language, shared by the team.
CREATE TABLE chat_languages (
  chat_jid TEXT PRIMARY KEY,
  detected TEXT,
  mixed TEXT,
  chosen TEXT,
  outgoing TEXT,
  updated_at INTEGER NOT NULL
);

-- Each teammate's Live translate switch, per chat (a row = on).
CREATE TABLE live_translate_switches (
  user_id INTEGER NOT NULL,
  chat_jid TEXT NOT NULL,
  on_since INTEGER NOT NULL,
  PRIMARY KEY (user_id, chat_jid)
);
CREATE INDEX idx_live_translate_switches_chat ON live_translate_switches(chat_jid);

-- Translations per person per day (business time zone), for the daily limit and Settings → AI.
CREATE TABLE live_translate_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE users ADD COLUMN translate_language TEXT;
ALTER TABLE users ADD COLUMN translate_send_without_preview INTEGER NOT NULL DEFAULT 0;

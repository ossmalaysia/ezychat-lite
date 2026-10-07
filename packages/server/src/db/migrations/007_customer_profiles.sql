-- Customer profiles (lead info): one per direct chat. Empty values are stored as NULL.
-- No foreign key to chats (like notes/messages): teammate-written data never cascades. An older app
-- version's chat merge deletes chat rows without moving profiles; an orphan keyed by the old JID is
-- recoverable, a cascade delete is not. `id` is a stable customer id that survives chat merges.
CREATE TABLE customer_profiles (
  chat_jid TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  email TEXT,
  other_phone TEXT,
  address TEXT,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE customer_tags (
  chat_jid TEXT NOT NULL,
  tag TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_jid, tag_key)
);
CREATE INDEX idx_customer_tags_key ON customer_tags(tag_key);

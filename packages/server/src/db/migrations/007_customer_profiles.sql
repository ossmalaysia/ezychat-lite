-- Customer profiles (lead info): one per direct chat. Empty values are stored as NULL.
CREATE TABLE customer_profiles (
  chat_jid TEXT PRIMARY KEY REFERENCES chats(jid) ON DELETE CASCADE,
  name TEXT,
  company TEXT,
  email TEXT,
  other_phone TEXT,
  address TEXT,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE customer_tags (
  chat_jid TEXT NOT NULL REFERENCES chats(jid) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_jid, tag_key)
);
CREATE INDEX idx_customer_tags_key ON customer_tags(tag_key);

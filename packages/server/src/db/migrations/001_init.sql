-- 001_init: initial schema. Timestamps are INTEGER epoch ms; booleans INTEGER 0/1.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE chats (
  jid TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  name TEXT NOT NULL DEFAULT '',
  avatar_path TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  last_message_preview TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_chats_last_message ON chats(last_message_at DESC, jid);
CREATE INDEX idx_chats_updated ON chats(updated_at);
CREATE INDEX idx_chats_assigned ON chats(assigned_to);

CREATE TABLE contacts (
  jid TEXT PRIMARY KEY,
  push_name TEXT,
  saved_name TEXT,
  phone TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT,
  sender_name TEXT,
  from_me INTEGER NOT NULL DEFAULT 0,
  sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'video', 'audio', 'document', 'sticker', 'system')),
  body TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_name TEXT,
  media_status TEXT NOT NULL DEFAULT 'none' CHECK (media_status IN ('none', 'ok', 'failed', 'pending')),
  quoted_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  error TEXT,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  client_id TEXT
);
CREATE INDEX idx_messages_chat_ts ON messages(chat_jid, timestamp, id);
CREATE UNIQUE INDEX idx_messages_client_id ON messages(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_messages_status ON messages(status) WHERE status = 'pending';

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_chat ON notes(chat_jid, created_at);

CREATE TABLE chat_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('assigned', 'unassigned', 'resolved', 'reopened')),
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  at INTEGER NOT NULL
);
CREATE INDEX idx_chat_events_chat ON chat_events(chat_jid, at);

CREATE TABLE quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shortcut TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  ip TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  at INTEGER NOT NULL
);
CREATE INDEX idx_audit_at ON audit_log(at);

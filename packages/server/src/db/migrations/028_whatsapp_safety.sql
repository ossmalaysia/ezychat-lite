-- WhatsApp Safety (docs/features/whatsapp-safety/design.md): one row per flagged message, the
-- numbers the team reported, trusted or blocked, and every download of a flagged file. No message
-- text is copied here: the message row keeps it.
CREATE TABLE safety_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  chat_jid TEXT NOT NULL,
  inbox_id INTEGER NOT NULL,
  -- JSON array of rule codes, most important first
  rules TEXT NOT NULL,
  score INTEGER NOT NULL,
  rule_level TEXT NOT NULL CHECK (rule_level IN ('none', 'warning', 'high')),
  critical INTEGER NOT NULL CHECK (critical IN (0, 1)),
  ai_level TEXT CHECK (ai_level IN ('none', 'warning', 'high')),
  ai_category TEXT,
  ai_reason TEXT,
  level TEXT NOT NULL CHECK (level IN ('none', 'warning', 'high')),
  status TEXT NOT NULL CHECK (status IN ('open', 'safe', 'reported', 'blocked', 'cleared')),
  existing_customer INTEGER NOT NULL CHECK (existing_customer IN (0, 1)),
  has_file INTEGER NOT NULL CHECK (has_file IN (0, 1)),
  -- the file was moved to media/quarantine (agents cannot download it until released)
  quarantined INTEGER NOT NULL DEFAULT 0 CHECK (quarantined IN (0, 1)),
  released INTEGER NOT NULL DEFAULT 0 CHECK (released IN (0, 1)),
  deleted_by INTEGER,
  deleted_at INTEGER,
  auto_blocked INTEGER NOT NULL DEFAULT 0 CHECK (auto_blocked IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX safety_items_created ON safety_items (created_at);
CREATE INDEX safety_items_chat ON safety_items (chat_jid);

-- Shared by every inbox, keyed by the WhatsApp JID of the number (like contacts).
CREATE TABLE safety_numbers (
  wa_jid TEXT PRIMARY KEY,
  scam_by INTEGER,
  scam_at INTEGER,
  blocked_by INTEGER,
  blocked_at INTEGER,
  blocked_auto INTEGER NOT NULL DEFAULT 0 CHECK (blocked_auto IN (0, 1)),
  -- "trust this sender": 'file', 'text' or 'file,text'
  trusted TEXT
);

CREATE TABLE safety_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES safety_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  -- 0 = refused while locked
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  at INTEGER NOT NULL
);
CREATE INDEX safety_downloads_item ON safety_downloads (item_id);
CREATE INDEX safety_downloads_at ON safety_downloads (at);

-- Google Calendar connector (docs/features/google-calendar/design.md). The Google sign-in itself
-- lives in encrypted settings; these tables hold what each AI agent may do and what it did.
-- Chat keys carry no foreign key (user data never cascades with a chat); chats/merge.ts moves them.

-- Booking settings per AI agent (JSON of BookingSettings).
CREATE TABLE calendar_agent_settings (
  agent_id INTEGER PRIMARY KEY REFERENCES ai_agents(id) ON DELETE CASCADE,
  settings TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Free times the AI offered in a chat: only these may be booked (for 24 hours).
CREATE TABLE calendar_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  offered_at INTEGER NOT NULL
);
CREATE INDEX idx_calendar_offers_chat ON calendar_offers(chat_jid, start_at, offered_at);

-- Events the AI added to Google Calendar (history: no foreign key to the agent).
CREATE TABLE calendar_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  chat_jid TEXT NOT NULL,
  event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_calendar_bookings_chat_start ON calendar_bookings(chat_jid, start_at);

-- The connector's Activity tab: who and when, never chat text.
CREATE TABLE calendar_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('checked', 'booked', 'handed_over', 'failed')),
  agent_id INTEGER,
  chat_jid TEXT,
  start_at INTEGER,
  end_at INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX idx_calendar_activity_at ON calendar_activity(at DESC, id DESC);

-- Outgoing voice notes recorded in the inbox: sent to WhatsApp as push-to-talk audio, not as a file.
ALTER TABLE messages ADD COLUMN voice_note INTEGER NOT NULL DEFAULT 0 CHECK (voice_note IN (0, 1));

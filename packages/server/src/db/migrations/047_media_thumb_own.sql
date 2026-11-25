-- The chat preview the app makes itself from the stored photo (800 px), in place of WhatsApp's tiny
-- thumbnail (about 48 x 64 px, blurry when the chat shows it). own = 1 marks it, so it is made once.
ALTER TABLE media_thumbs ADD COLUMN own INTEGER NOT NULL DEFAULT 0;

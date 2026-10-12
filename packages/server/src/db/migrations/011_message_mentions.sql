-- NULL identifies old messages whose mention metadata was not retained.
-- [] identifies a new message that explicitly contains no WhatsApp mentions.
ALTER TABLE messages ADD COLUMN mentioned_jids TEXT;

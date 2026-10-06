-- Voice note transcripts (inbound live audio only). NULL status = never transcribed.
ALTER TABLE messages ADD COLUMN transcript TEXT;
ALTER TABLE messages ADD COLUMN transcript_lang TEXT;
ALTER TABLE messages ADD COLUMN transcript_status TEXT
  CHECK (transcript_status IS NULL OR transcript_status IN ('pending', 'ok', 'failed', 'too_long', 'unsupported', 'skipped'));

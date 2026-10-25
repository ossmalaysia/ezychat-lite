-- AI reply suggestions are on by default, but an install that existed before them starts with
-- them off: completions call the AI provider while people type, and that costs money. A new
-- install has no users while its migrations run, so it keeps the default (on).
INSERT OR IGNORE INTO settings (key, value)
  SELECT 'ai_reply_suggestions', 'false' WHERE EXISTS (SELECT 1 FROM users);
INSERT OR IGNORE INTO settings (key, value)
  SELECT 'ai_reply_suggestions_upgraded', 'true' WHERE EXISTS (SELECT 1 FROM users);

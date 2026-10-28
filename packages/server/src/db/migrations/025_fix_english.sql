-- Fix English (docs/features/grammar-fix/design.md). On by default, but an install that existed
-- before it starts with it off: the grammar check calls the AI provider while people type, and
-- that costs money. A new install has no users while its migrations run, so it keeps the default.
INSERT OR IGNORE INTO settings (key, value)
  SELECT 'fix_english', 'false' WHERE EXISTS (SELECT 1 FROM users);
INSERT OR IGNORE INTO settings (key, value)
  SELECT 'fix_english_upgraded', 'true' WHERE EXISTS (SELECT 1 FROM users);

-- Team words: never marked as a spelling mistake (product, place and customer words). One list per
-- install; a word is unique whatever its case. `added_by` keeps the user id (no foreign key: the
-- word stays when the user is removed).
CREATE TABLE fix_english_words (
  word TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  added_by INTEGER,
  created_at INTEGER NOT NULL
);

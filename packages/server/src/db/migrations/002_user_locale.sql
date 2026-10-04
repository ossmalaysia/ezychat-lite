-- Preferred UI language per user (shared/i18n LocaleSchema); NULL = follow the browser.
ALTER TABLE users ADD COLUMN locale TEXT;

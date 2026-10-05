-- One person, two WhatsApp addresses. A phone-number JID (PN) whose WhatsApp ID (LID) is known
-- routes to the LID chat (chats/aliases.ts). Existing duplicates are merged only by the startup
-- identity migration (chats/identity-migration.ts), never by this SQL.
CREATE TABLE jid_aliases (
  alias_jid      TEXT PRIMARY KEY,  -- the PN
  canonical_jid  TEXT NOT NULL,     -- the LID it belongs to
  source         TEXT NOT NULL,     -- 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore'
  learned_at     INTEGER NOT NULL,
  repointed_from TEXT               -- previous LID when the number moved to another person; its old
                                    -- PN chat is then never merged or routed to
);
CREATE INDEX idx_jid_aliases_canonical ON jid_aliases(canonical_jid);

ALTER TABLE chats ADD COLUMN phone TEXT;            -- PN digits for display/search; NULL when unknown
ALTER TABLE messages ADD COLUMN wa_remote_jid TEXT; -- JID WhatsApp used for this message (replies, read receipts)

UPDATE messages SET wa_remote_jid = chat_jid WHERE wa_remote_jid IS NULL;
UPDATE chats SET phone = substr(jid, 1, instr(jid, '@') - 1) WHERE jid LIKE '%@s.whatsapp.net';
UPDATE chats
   SET phone = (SELECT ct.phone FROM contacts ct WHERE ct.jid = chats.jid)
 WHERE phone IS NULL
   AND jid LIKE '%@lid'
   AND (SELECT ct.phone FROM contacts ct WHERE ct.jid = chats.jid) <> ''
   AND (SELECT ct.phone FROM contacts ct WHERE ct.jid = chats.jid) NOT GLOB '*[^0-9]*';

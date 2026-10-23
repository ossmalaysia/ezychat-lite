-- The teammate who sent the linked number's reaction from the inbox (row reactor 'me'). NULL when the
-- phone or another linked device reacted; a later reaction from there clears it. No foreign key:
-- reactions keep their history when a user is deleted (the name then shows as unknown).
ALTER TABLE message_reactions ADD COLUMN sent_by_user_id INTEGER;

import { TEAM_WORDS_MAX, type TeamWordsResult } from '@ezychat/shared';
import { listAgents } from '../ai/agents.js';
import { audit } from '../db/audit.js';
import type { DB } from '../db/index.js';
import { errors } from '../http/errors.js';

/** Business context words sent to the browser at most (distinct, lower case). */
export const BUSINESS_WORDS_MAX = 5_000;

type Actor = { userId: number | null; ip: string | null };

/**
 * The words of every agent's Business context that a teammate may use without a spelling mark
 * (product, place and dish names). Internal items are left out: the list goes to every user.
 */
export function businessWords(db: DB): string[] {
  const words = new Set<string>();
  const items = db.prepare(
    'SELECT text FROM ai_documents WHERE agent_id = ? AND internal = 0 ORDER BY id',
  );
  for (const agent of listAgents(db))
    for (const { text } of items.all(agent.id) as { text: string }[])
      for (const match of text.matchAll(/\p{L}[\p{L}\p{M}']*/gu)) {
        if (words.size >= BUSINESS_WORDS_MAX) return [...words];
        if (match[0].length > 1) words.add(match[0].toLowerCase());
      }
  return [...words];
}

/**
 * Team words (docs/features/grammar-fix/design.md): any signed-in user adds one from the underline
 * card, admins remove them. One list per install; a word is unique whatever its case. Each change
 * is audited with the word (a team word is not chat text).
 */
export class TeamWordStore {
  constructor(private readonly db: DB) {}

  list(): TeamWordsResult {
    const words = this.db
      .prepare(
        `SELECT w.word, u.display_name AS addedBy, w.created_at AS createdAt
           FROM fix_english_words w LEFT JOIN users u ON u.id = w.added_by
          ORDER BY w.word COLLATE NOCASE`,
      )
      .all() as TeamWordsResult['words'];
    return { words, businessWords: businessWords(this.db) };
  }

  add(word: string, actor: Actor, now = Date.now()): TeamWordsResult {
    const exists = this.db.prepare('SELECT 1 FROM fix_english_words WHERE word = ?').get(word);
    if (!exists) {
      const { n } = this.db.prepare('SELECT count(*) AS n FROM fix_english_words').get() as {
        n: number;
      };
      if (n >= TEAM_WORDS_MAX)
        throw errors.conflict(`The team word list is full (${TEAM_WORDS_MAX} words)`);
      this.db
        .prepare('INSERT INTO fix_english_words (word, added_by, created_at) VALUES (?, ?, ?)')
        .run(word, actor.userId, now);
      audit(this.db, { ...actor, action: 'fix_english.word_add', meta: { word } });
    }
    return this.list();
  }

  remove(word: string, actor: Actor): TeamWordsResult {
    const removed = this.db.prepare('DELETE FROM fix_english_words WHERE word = ?').run(word);
    if (!removed.changes) throw errors.notFound('Team word');
    audit(this.db, { ...actor, action: 'fix_english.word_remove', meta: { word } });
    return this.list();
  }
}

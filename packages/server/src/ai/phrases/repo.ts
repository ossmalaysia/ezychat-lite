import {
  REPLY_PHRASES_PER_LANGUAGE,
  type ReplyPhrase,
  type ReplyPhraseLanguage,
  type ReplyPhraseSource,
} from '@ezychat/shared';
import type { DB } from '../../db/index.js';

/** The phrase list's only SQL (table `reply_phrases`); every statement is per agent. */
export interface NewPhrase {
  text: string;
  language: ReplyPhraseLanguage;
  source: ReplyPhraseSource;
  fact: boolean;
}

interface Row {
  id: number;
  text: string;
  language: ReplyPhraseLanguage;
  source: ReplyPhraseSource;
  uses: number;
  fact: number;
  createdAt: number;
}

const COLUMNS = 'id, text, language, source, uses, fact, created_at AS createdAt';
const toPhrase = ({ fact, createdAt: _createdAt, ...row }: Row): ReplyPhrase => ({
  ...row,
  fact: !!fact,
});

export type StoredPhrase = ReplyPhrase & { createdAt: number };

export class PhraseRepo {
  constructor(private readonly db: DB) {}

  /** Most used first, newest first among equals. */
  list(agentId: number): ReplyPhrase[] {
    return this.stored(agentId).map(({ createdAt: _createdAt, ...p }) => p);
  }

  stored(agentId: number): StoredPhrase[] {
    return (
      this.db
        .prepare(
          `SELECT ${COLUMNS} FROM reply_phrases WHERE agent_id = ? ORDER BY uses DESC, id DESC`,
        )
        .all(agentId) as Row[]
    ).map((row) => ({ ...toPhrase(row), createdAt: row.createdAt }));
  }

  get(agentId: number, id: number): ReplyPhrase | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM reply_phrases WHERE agent_id = ? AND id = ?`)
      .get(agentId, id) as Row | undefined;
    return row ? toPhrase(row) : null;
  }

  /** The agent a phrase belongs to (admin routes take a phrase id only). */
  agentOf(id: number): number | null {
    const row = this.db
      .prepare('SELECT agent_id AS agentId FROM reply_phrases WHERE id = ?')
      .get(id) as { agentId: number } | undefined;
    return row?.agentId ?? null;
  }

  add(agentId: number, phrase: NewPhrase, now = Date.now()): ReplyPhrase {
    const info = this.db
      .prepare(
        'INSERT INTO reply_phrases (agent_id, language, text, source, fact, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(agentId, phrase.language, phrase.text, phrase.source, phrase.fact ? 1 : 0, now, now);
    return this.get(agentId, Number(info.lastInsertRowid))!;
  }

  /** An admin edit makes the phrase the admin's (the AI never replaces it). */
  update(
    agentId: number,
    id: number,
    text: string,
    language: ReplyPhraseLanguage,
    fact: boolean,
    now = Date.now(),
  ) {
    this.db
      .prepare(
        "UPDATE reply_phrases SET text = ?, language = ?, fact = ?, source = 'admin', updated_at = ? WHERE agent_id = ? AND id = ?",
      )
      .run(text, language, fact ? 1 : 0, now, agentId, id);
    return this.get(agentId, id);
  }

  remove(agentId: number, id: number): boolean {
    return (
      this.db.prepare('DELETE FROM reply_phrases WHERE agent_id = ? AND id = ?').run(agentId, id)
        .changes > 0
    );
  }

  /** Tab / Accept counts up, Esc counts down (never below 0). */
  feedback(agentId: number, id: number, accepted: boolean): boolean {
    return (
      this.db
        .prepare(
          `UPDATE reply_phrases SET uses = ${accepted ? 'uses + 1' : 'max(uses - 1, 0)'} WHERE agent_id = ? AND id = ?`,
        )
        .run(agentId, id).changes > 0
    );
  }

  /**
   * One build's result in one transaction: drop the given AI phrases, add the new ones, then keep at
   * most `REPLY_PHRASES_PER_LANGUAGE` per language (admin phrases first, then most used, newest).
   */
  replace(
    agentId: number,
    drop: readonly number[],
    add: readonly NewPhrase[],
    now = Date.now(),
  ): void {
    this.db.transaction(() => {
      const del = this.db.prepare('DELETE FROM reply_phrases WHERE agent_id = ? AND id = ?');
      for (const id of drop) del.run(agentId, id);
      for (const phrase of add) this.add(agentId, phrase, now);
      this.db
        .prepare(
          `DELETE FROM reply_phrases WHERE agent_id = ? AND id IN (
             SELECT id FROM (
               SELECT id, row_number() OVER (
                 PARTITION BY language ORDER BY (source = 'admin') DESC, uses DESC, id DESC
               ) AS n FROM reply_phrases WHERE agent_id = ?
             ) WHERE n > ?
           )`,
        )
        .run(agentId, agentId, REPLY_PHRASES_PER_LANGUAGE);
    })();
  }

  /** Nightly: AI phrases nobody used, older than `before`. */
  pruneUnused(agentId: number, before: number): number {
    return this.db
      .prepare(
        "DELETE FROM reply_phrases WHERE agent_id = ? AND source != 'admin' AND uses = 0 AND created_at < ?",
      )
      .run(agentId, before).changes;
  }

  counts(agentId: number): { language: ReplyPhraseLanguage; count: number }[] {
    return this.db
      .prepare(
        "SELECT language, COUNT(*) AS count FROM reply_phrases WHERE agent_id = ? GROUP BY language ORDER BY CASE language WHEN 'en' THEN 0 WHEN 'ms' THEN 1 ELSE 2 END",
      )
      .all(agentId) as { language: ReplyPhraseLanguage; count: number }[];
  }
}

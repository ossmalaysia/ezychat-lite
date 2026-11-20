import type { TranslateLanguage } from '@ezychat/shared';
import type { DB } from '../db/index.js';

/** The only SQL of Live translate (migration 046). */

export interface TranslationRow {
  message_id: string;
  revision: number;
  target: string;
  source: string;
  text: string;
  status: 'ok' | 'unsafe' | 'same';
  model: string | null;
  created_at: number;
}

export interface TypedRow {
  message_id: string;
  user_id: number | null;
  typed_text: string;
  typed_lang: string;
  sent_lang: string;
  edited: number;
  sent_original: number;
  created_at: number;
}

export interface ChatLanguageRow {
  chat_jid: string;
  detected: string | null;
  mixed: string | null;
  chosen: string | null;
  outgoing: string | null;
  updated_at: number;
}

export interface UserTranslatePrefs {
  translateLanguage: TranslateLanguage | null;
  sendWithoutPreview: boolean;
}

/** Renames a message's Live translate rows with the message (the optimistic id → WhatsApp's id). */
export function renameTranslateRows(db: DB, from: string, to: string): void {
  db.prepare('UPDATE OR REPLACE message_typed SET message_id = ? WHERE message_id = ?').run(
    to,
    from,
  );
  db.prepare('UPDATE OR REPLACE message_translations SET message_id = ? WHERE message_id = ?').run(
    to,
    from,
  );
}

/** A message removed from the database takes its Live translate rows with it. */
export function dropTranslateRows(db: DB, messageId: string): void {
  db.prepare('DELETE FROM message_typed WHERE message_id = ?').run(messageId);
  db.prepare('DELETE FROM message_translations WHERE message_id = ?').run(messageId);
}

/**
 * Moves a chat's shared languages and the switches to the surviving chat of an alias merge: its own
 * values win, a language only the other chat had chosen is kept.
 */
export function mergeTranslateRows(db: DB, from: string, to: string): void {
  db.prepare(
    `INSERT INTO chat_languages (chat_jid, detected, mixed, chosen, outgoing, updated_at)
     SELECT ?, detected, mixed, chosen, outgoing, updated_at FROM chat_languages WHERE chat_jid = ?
     ON CONFLICT (chat_jid) DO UPDATE SET
       chosen = COALESCE(chat_languages.chosen, excluded.chosen),
       outgoing = COALESCE(chat_languages.outgoing, excluded.outgoing)`,
  ).run(to, from);
  db.prepare('DELETE FROM chat_languages WHERE chat_jid = ?').run(from);
  db.prepare(
    `INSERT OR IGNORE INTO live_translate_switches (user_id, chat_jid, on_since)
     SELECT user_id, ?, on_since FROM live_translate_switches WHERE chat_jid = ?`,
  ).run(to, from);
  db.prepare('DELETE FROM live_translate_switches WHERE chat_jid = ?').run(from);
}

/** The columns of a stored message Live translate reads. */
export interface SourceMessage {
  id: string;
  chat_jid: string;
  from_me: number;
  type: string;
  body: string | null;
  transcript: string | null;
  transcript_status: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  hidden_at: number | null;
}

const SOURCE_COLUMNS =
  'id, chat_jid, from_me, type, body, transcript, transcript_status, edited_at, deleted_at, hidden_at';

export class LiveTranslateRepo {
  constructor(private readonly db: DB) {}

  /** The stored messages of `ids` in chat `jid` (others are left out). */
  messages(jid: string, ids: readonly string[]): SourceMessage[] {
    if (!ids.length) return [];
    return this.db
      .prepare(
        `SELECT ${SOURCE_COLUMNS} FROM messages
         WHERE chat_jid = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .all(jid, JSON.stringify(ids)) as SourceMessage[];
  }

  /** The chat's newest messages from the customer (or group members) with text, newest first. */
  recentInbound(jid: string, limit: number): SourceMessage[] {
    return this.db
      .prepare(
        `SELECT ${SOURCE_COLUMNS} FROM messages
         WHERE chat_jid = ? AND from_me = 0 AND type != 'system' AND deleted_at IS NULL
           AND hidden_at IS NULL AND (body IS NOT NULL OR transcript IS NOT NULL)
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(jid, limit) as SourceMessage[];
  }

  translations(
    keys: ReadonlyArray<{ id: string; revision: number }>,
    target: string,
  ): Map<string, TranslationRow> {
    const out = new Map<string, TranslationRow>();
    if (!keys.length) return out;
    const rows = this.db
      .prepare(
        `SELECT t.* FROM message_translations t
         JOIN json_each(?) k ON t.message_id = json_extract(k.value, '$.id')
           AND t.revision = json_extract(k.value, '$.revision')
         WHERE t.target = ?`,
      )
      .all(JSON.stringify(keys), target) as TranslationRow[];
    for (const row of rows) out.set(row.message_id, row);
    return out;
  }

  /** The cached source language of each message (any target), for detection. */
  sources(ids: readonly string[]): Map<string, string> {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const rows = this.db
      .prepare(
        `SELECT message_id, source FROM message_translations
         WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY created_at`,
      )
      .all(JSON.stringify(ids)) as Array<{ message_id: string; source: string }>;
    for (const row of rows) out.set(row.message_id, row.source);
    return out;
  }

  putTranslation(row: TranslationRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO message_translations
           (message_id, revision, target, source, text, status, model, created_at)
         VALUES (@message_id, @revision, @target, @source, @text, @status, @model, @created_at)`,
      )
      .run(row);
  }

  /** A deleted (or hidden) message keeps no translations. */
  dropTranslations(messageId: string): void {
    this.db.prepare('DELETE FROM message_translations WHERE message_id = ?').run(messageId);
  }

  typed(ids: readonly string[]): Map<string, TypedRow> {
    const out = new Map<string, TypedRow>();
    if (!ids.length) return out;
    const rows = this.db
      .prepare('SELECT * FROM message_typed WHERE message_id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids)) as TypedRow[];
    for (const row of rows) out.set(row.message_id, row);
    return out;
  }

  putTyped(row: TypedRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO message_typed
           (message_id, user_id, typed_text, typed_lang, sent_lang, edited, sent_original, created_at)
         VALUES (@message_id, @user_id, @typed_text, @typed_lang, @sent_lang, @edited, @sent_original,
           @created_at)`,
      )
      .run(row);
  }

  chatLanguage(jid: string): ChatLanguageRow | null {
    return (
      (this.db.prepare('SELECT * FROM chat_languages WHERE chat_jid = ?').get(jid) as
        ChatLanguageRow | undefined) ?? null
    );
  }

  /** Writes the given columns of a chat's languages (a missing row is created). */
  setChatLanguage(
    jid: string,
    patch: Partial<Pick<ChatLanguageRow, 'detected' | 'mixed' | 'chosen' | 'outgoing'>>,
    now: number,
  ): void {
    const current = this.chatLanguage(jid);
    const next = {
      chat_jid: jid,
      detected: current?.detected ?? null,
      mixed: current?.mixed ?? null,
      chosen: current?.chosen ?? null,
      outgoing: current?.outgoing ?? null,
      ...patch,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO chat_languages (chat_jid, detected, mixed, chosen, outgoing, updated_at)
         VALUES (@chat_jid, @detected, @mixed, @chosen, @outgoing, @updated_at)`,
      )
      .run(next);
  }

  isOn(userId: number, jid: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM live_translate_switches WHERE user_id = ? AND chat_jid = ?')
      .get(userId, jid);
  }

  setOn(userId: number, jid: string, on: boolean, now: number): void {
    if (on)
      this.db
        .prepare(
          'INSERT OR IGNORE INTO live_translate_switches (user_id, chat_jid, on_since) VALUES (?, ?, ?)',
        )
        .run(userId, jid, now);
    else
      this.db
        .prepare('DELETE FROM live_translate_switches WHERE user_id = ? AND chat_jid = ?')
        .run(userId, jid);
  }

  used(userId: number, day: string): number {
    const row = this.db
      .prepare('SELECT count FROM live_translate_usage WHERE user_id = ? AND day = ?')
      .get(userId, day) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Adds `count`; a negative count gives back a reserved one (never below 0). */
  addUsage(userId: number, day: string, count: number): void {
    if (count === 0) return;
    if (count < 0) {
      this.db
        .prepare(
          'UPDATE live_translate_usage SET count = MAX(0, count + ?) WHERE user_id = ? AND day = ?',
        )
        .run(count, userId, day);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO live_translate_usage (user_id, day, count) VALUES (?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET count = count + excluded.count`,
      )
      .run(userId, day, count);
  }

  /** Everyone's use on one day (Settings → AI). */
  usageOn(day: string): { people: number; translations: number } {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS people, COALESCE(SUM(count), 0) AS translations FROM live_translate_usage WHERE day = ? AND count > 0',
      )
      .get(day) as { people: number; translations: number };
    return row;
  }

  /** Days before `day` are no longer needed. */
  pruneUsage(day: string): void {
    this.db.prepare('DELETE FROM live_translate_usage WHERE day < ?').run(day);
  }

  prefs(userId: number): UserTranslatePrefs {
    const row = this.db
      .prepare(
        'SELECT translate_language AS lang, translate_send_without_preview AS noPreview FROM users WHERE id = ?',
      )
      .get(userId) as { lang: string | null; noPreview: number } | undefined;
    return {
      translateLanguage: (row?.lang as TranslateLanguage | null | undefined) ?? null,
      sendWithoutPreview: row?.noPreview === 1,
    };
  }

  setPrefs(userId: number, patch: Partial<UserTranslatePrefs>): void {
    if (patch.translateLanguage !== undefined)
      this.db
        .prepare('UPDATE users SET translate_language = ? WHERE id = ?')
        .run(patch.translateLanguage, userId);
    if (patch.sendWithoutPreview !== undefined)
      this.db
        .prepare('UPDATE users SET translate_send_without_preview = ? WHERE id = ?')
        .run(patch.sendWithoutPreview ? 1 : 0, userId);
  }
}

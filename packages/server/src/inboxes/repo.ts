import type { InboxTone } from '@ezychat/shared';
import type { DB } from '../db/index.js';

export interface InboxRow {
  id: number;
  name: string;
  tone: InboxTone;
  /** Baileys auth folder relative to the data dir: `wa-auth` (inbox 1) or `wa-auth-inboxes/<id>`. */
  auth_dir: string;
  /** The linked account's own JID, kept after a disconnect (alias learning ignores it). */
  own_jid: string | null;
  /** Connection type (migration 019): `linked_phone` or a type an extension registers. */
  type: string;
  created_at: number;
  removed_at: number | null;
}

/** Chip colours in creation order; the fifth inbox starts again. */
const TONES: readonly InboxTone[] = ['primary', 'warning', 'info', 'success'];

/** Folder of a new inbox's Baileys files: a sibling of wa-auth/, never inside it (wipe is rm -rf). */
export function inboxAuthDir(id: number): string {
  return `wa-auth-inboxes/${id}`;
}

/** The `inboxes` and `inbox_members` tables. */
export class InboxRepo {
  constructor(private readonly db: DB) {}

  /** Every inbox, removed ones included, by id. */
  list(): InboxRow[] {
    return this.db.prepare('SELECT * FROM inboxes ORDER BY id').all() as InboxRow[];
  }

  /** Inboxes that are not removed, by id. */
  active(): InboxRow[] {
    return this.db
      .prepare('SELECT * FROM inboxes WHERE removed_at IS NULL ORDER BY id')
      .all() as InboxRow[];
  }

  get(id: number): InboxRow | null {
    return (this.db.prepare('SELECT * FROM inboxes WHERE id = ?').get(id) as InboxRow) ?? null;
  }

  /** Tone of the next inbox: by creation order, removed inboxes included. */
  nextTone(): InboxTone {
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM inboxes').get() as { n: number };
    return TONES[n % TONES.length]!;
  }

  /** Adds an inbox; ids are never reused (removed rows stay), so its folder is always new. */
  insert(name: string, tone: InboxTone, now: number, type = 'linked_phone'): InboxRow {
    return this.db.transaction(() => {
      const { next } = this.db
        .prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM inboxes')
        .get() as { next: number };
      this.db
        .prepare(
          'INSERT INTO inboxes (id, name, tone, auth_dir, own_jid, type, created_at, removed_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)',
        )
        .run(next, name, tone, inboxAuthDir(next), type, now);
      return this.get(next)!;
    })();
  }

  rename(id: number, name: string): void {
    this.db.prepare('UPDATE inboxes SET name = ? WHERE id = ?').run(name, id);
  }

  setType(id: number, type: string): void {
    this.db.prepare('UPDATE inboxes SET type = ? WHERE id = ?').run(type, id);
  }

  markRemoved(id: number, now: number): void {
    this.db.prepare('UPDATE inboxes SET removed_at = ? WHERE id = ?').run(now, id);
  }

  setOwnJid(id: number, jid: string | null): void {
    this.db.prepare('UPDATE inboxes SET own_jid = ? WHERE id = ?').run(jid, id);
  }

  /** User ids of the agents who may open the inbox, ascending. */
  members(inboxId: number): number[] {
    return (
      this.db
        .prepare('SELECT user_id FROM inbox_members WHERE inbox_id = ? ORDER BY user_id')
        .all(inboxId) as Array<{ user_id: number }>
    ).map((r) => r.user_id);
  }

  /** Replaces the members of one inbox. */
  setMembers(inboxId: number, userIds: number[]): void {
    const del = this.db.prepare('DELETE FROM inbox_members WHERE inbox_id = ?');
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO inbox_members (inbox_id, user_id) VALUES (?, ?)',
    );
    this.db.transaction(() => {
      del.run(inboxId);
      for (const userId of userIds) ins.run(inboxId, userId);
    })();
  }

  /** Inbox ids the user is a member of, ascending (removed inboxes included). */
  userInboxIds(userId: number): number[] {
    return (
      this.db
        .prepare('SELECT inbox_id FROM inbox_members WHERE user_id = ? ORDER BY inbox_id')
        .all(userId) as Array<{ inbox_id: number }>
    ).map((r) => r.inbox_id);
  }

  /** Replaces the inboxes one user is a member of. */
  setUserInboxes(userId: number, inboxIds: number[]): void {
    const del = this.db.prepare('DELETE FROM inbox_members WHERE user_id = ?');
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO inbox_members (inbox_id, user_id) VALUES (?, ?)',
    );
    this.db.transaction(() => {
      del.run(userId);
      for (const inboxId of inboxIds) ins.run(inboxId, userId);
    })();
  }
}

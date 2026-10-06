import {
  CUSTOMER_TAG_LIMIT,
  customerTagKey,
  normalizeTag,
  type CustomerProfile,
} from '@wa-team-inbox/shared';
import type { DB } from '../db/index.js';

export const PROFILE_FIELDS = ['name', 'company', 'email', 'otherPhone', 'address'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileFields = Record<ProfileField, string | null>;

interface ProfileRow {
  name: string | null;
  company: string | null;
  email: string | null;
  other_phone: string | null;
  address: string | null;
  updated_at: number;
  updated_by: number | null;
}

/** Escapes LIKE wildcards for use with `ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export class CustomerRepo {
  constructor(private readonly db: DB) {}

  get(chatJid: string): CustomerProfile | null {
    const r = this.db
      .prepare(
        'SELECT name, company, email, other_phone, address, updated_at, updated_by FROM customer_profiles WHERE chat_jid = ?',
      )
      .get(chatJid) as ProfileRow | undefined;
    const tags = this.tags(chatJid);
    if (!r && !tags.length) return null;
    return {
      name: r?.name ?? null,
      company: r?.company ?? null,
      email: r?.email ?? null,
      otherPhone: r?.other_phone ?? null,
      address: r?.address ?? null,
      tags,
      updatedAt: r?.updated_at ?? null,
      updatedBy: r?.updated_by ?? null,
    };
  }

  tags(chatJid: string): string[] {
    return (
      this.db
        .prepare('SELECT tag FROM customer_tags WHERE chat_jid = ? ORDER BY created_at, rowid')
        .all(chatJid) as Array<{ tag: string }>
    ).map((r) => r.tag);
  }

  /** Dedupe by key (keeping the first), reuse the spelling already stored anywhere, cap at the limit. */
  canonicalTags(tags: string[]): string[] {
    const existing = this.db.prepare(
      'SELECT tag FROM customer_tags WHERE tag_key = ? ORDER BY created_at, rowid LIMIT 1',
    );
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags) {
      const tag = normalizeTag(raw);
      const key = customerTagKey(tag);
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      const prior = existing.get(key) as { tag: string } | undefined;
      out.push(prior?.tag ?? tag);
      if (out.length === CUSTOMER_TAG_LIMIT) break;
    }
    return out;
  }

  /** Upsert the fields and replace the tags in one transaction. Tags must already be canonical. */
  save(
    chatJid: string,
    fields: ProfileFields,
    tags: string[],
    userId: number | null,
    now: number,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO customer_profiles (chat_jid, name, company, email, other_phone, address, updated_at, updated_by)
           VALUES (@chatJid, @name, @company, @email, @otherPhone, @address, @now, @userId)
           ON CONFLICT(chat_jid) DO UPDATE SET name = @name, company = @company, email = @email,
             other_phone = @otherPhone, address = @address, updated_at = @now, updated_by = @userId`,
        )
        .run({ chatJid, ...fields, now, userId });
      this.db.prepare('DELETE FROM customer_tags WHERE chat_jid = ?').run(chatJid);
      const insert = this.db.prepare(
        'INSERT INTO customer_tags (chat_jid, tag, tag_key, created_at) VALUES (?, ?, ?, ?)',
      );
      tags.forEach((tag, i) => insert.run(chatJid, tag, customerTagKey(tag), now + i));
    })();
  }

  /** Existing tags for the tag input: prefix matches, most used first. */
  suggest(q: string | undefined, limit = 20): string[] {
    const key = q ? customerTagKey(q) : '';
    const rows = this.db
      .prepare(
        `SELECT MIN(tag) AS tag, COUNT(*) AS uses FROM customer_tags
         WHERE tag_key LIKE @prefix ESCAPE '\\'
         GROUP BY tag_key ORDER BY uses DESC, tag_key ASC LIMIT @limit`,
      )
      .all({ prefix: `${escapeLike(key)}%`, limit }) as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  }

  /** Profile names for the given chats (only those with a name). */
  namesByChat(chatJids: string[]): Map<string, string> {
    const out = new Map<string, string>();
    if (!chatJids.length) return out;
    const marks = chatJids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT chat_jid, name FROM customer_profiles WHERE chat_jid IN (${marks}) AND name IS NOT NULL`,
      )
      .all(...chatJids) as Array<{ chat_jid: string; name: string }>;
    for (const r of rows) out.set(r.chat_jid, r.name);
    return out;
  }
}

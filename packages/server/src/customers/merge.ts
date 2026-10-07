import { customerTagKey } from '@wa-team-inbox/shared';
import type { DB } from '../db/index.js';
import { CustomerRepo, PROFILE_FIELDS, type ProfileFields } from './repo.js';

/**
 * Startup identity merge: carry `from`'s customer profile into `to`. Newest non-empty value per
 * field wins and the newer profile's stable id survives; tags are unioned (newer profile's first,
 * first spelling kept, capped at the limit).
 * Runs inside mergeChat's transaction, after the `to` chat row exists and before `from` is deleted.
 * Reports counts only (never values): `tagsDropped` = tags beyond the cap.
 */
export function mergeCustomerProfile(
  db: DB,
  from: string,
  to: string,
): { profiles: number; tags: number; tagsDropped: number } {
  const repo = new CustomerRepo(db);
  const a = repo.get(from);
  if (!a) return { profiles: 0, tags: 0, tagsDropped: 0 };
  const b = repo.get(to);
  const fromNewer = !b || (a.updatedAt ?? 0) > (b.updatedAt ?? 0);
  const [newer, older] = fromNewer ? [a, b] : [b, a];
  const fields = Object.fromEntries(
    PROFILE_FIELDS.map((f) => [f, newer[f] ?? older?.[f] ?? null]),
  ) as ProfileFields;
  const union = [...newer.tags, ...(older?.tags ?? [])];
  const tags = repo.canonicalTags(union);
  const tagsDropped = new Set(union.map((tag) => customerTagKey(tag))).size - tags.length;
  // Delete `from` first: the id is UNIQUE and may move to `to`.
  db.prepare('DELETE FROM customer_profiles WHERE chat_jid = ?').run(from);
  db.prepare('DELETE FROM customer_tags WHERE chat_jid = ?').run(from);
  repo.save(
    to,
    fields,
    tags,
    newer.updatedBy ?? null,
    Math.max(a.updatedAt ?? 0, b?.updatedAt ?? 0),
    newer.id ?? older?.id ?? undefined,
  );
  return { profiles: 1, tags: tags.length, tagsDropped };
}

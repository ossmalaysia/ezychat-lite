import type { User } from '@ezychat/shared';
import type { AppContext } from '../context.js';

/** Inboxes a user may open: every inbox, or a set of inbox ids. */
export type InboxScope = 'all' | ReadonlySet<number>;

type InboxCtx = Pick<AppContext, 'db' | 'inboxes'>;

/**
 * Admins and the AI member open every inbox (removed ones too, read only). Agents open the active
 * inboxes they are members of. With a single-inbox build (Lite) that has only inbox 1, everyone
 * opens it.
 */
export function scopeFor(ctx: InboxCtx, user: Pick<User, 'id' | 'role' | 'kind'>): InboxScope {
  if (user.role === 'admin' || user.kind === 'ai') return 'all';
  if (isSingleInbox(ctx)) return 'all';
  const active = new Set(ctx.inboxes.repo.active().map((r) => r.id));
  return new Set(ctx.inboxes.repo.userInboxIds(user.id).filter((id) => active.has(id)));
}

/**
 * The Lite shortcut: a build limited to one inbox whose data dir holds only inbox 1. A data dir
 * left with more active inboxes by a bigger build keeps member scoping.
 */
function isSingleInbox(ctx: InboxCtx): boolean {
  if (ctx.inboxes.connections.maxInboxes() !== 1) return false;
  const active = ctx.inboxes.repo.active();
  return active.length === 1 && active[0]!.id === 1;
}

export function canOpen(scope: InboxScope, inboxId: number): boolean {
  return scope === 'all' || scope.has(inboxId);
}

/** Active inbox ids in the scope, ascending. */
export function scopeIds(ctx: InboxCtx, scope: InboxScope): number[] {
  return ctx.inboxes.repo
    .active()
    .map((r) => r.id)
    .filter((id) => canOpen(scope, id));
}

/**
 * Active human users who may open the inbox: admins plus its members (every active human with a
 * single-inbox build). A removed inbox is for admins only. Ascending ids.
 */
export function usersWhoCanOpen(ctx: InboxCtx, inboxId: number): number[] {
  const row = ctx.inboxes.repo.get(inboxId);
  if (!row) return [];
  const everyone = row.removed_at === null && isSingleInbox(ctx);
  const members = row.removed_at === null;
  const rows = ctx.db
    .prepare(
      `SELECT id FROM users
       WHERE kind = 'human' AND disabled_at IS NULL
         AND (role = 'admin' OR ? = 1
              OR (? = 1 AND id IN (SELECT user_id FROM inbox_members WHERE inbox_id = ?)))
       ORDER BY id`,
    )
    .all(everyone ? 1 : 0, members ? 1 : 0, inboxId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}
